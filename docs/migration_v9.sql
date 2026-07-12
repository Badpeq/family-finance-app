-- ============================================================
-- MIGRACIÓN V9: Fix v_gastos_programados_mes + ciclo facturación
-- Ejecutar en Supabase SQL Editor → New query
-- Esquema real verificado 2026-07-12:
--   gastos_recurrentes: activo (no aplicado)
--   compras_cuotas: cuota_actual (no cuotas_pagadas), sin activo
-- ============================================================

-- ── 1. Recrear vista con aplicado dinámico ───────────────────
-- DROP primero porque la estructura de columnas cambió (no se puede ALTER VIEW).
DROP VIEW IF EXISTS public.v_gastos_programados_mes;

-- Para recurrentes: busca si ya existe una transacción vinculada en el mes actual.
-- Para cuotas: compara cuota_actual con el número de cuota esperado este mes.
CREATE VIEW public.v_gastos_programados_mes
WITH (security_invoker = true) AS
SELECT
  gr.id,
  'recurrente'::TEXT                AS tipo_programado,
  gr.descripcion,
  gr.categoria,
  gr.monto                          AS monto_cuota,
  gr.dia_cobro,
  EXISTS (
    SELECT 1
    FROM public.transacciones t
    WHERE t.gastos_recurrentes_id = gr.id
      AND t.activo = true
      AND t.fecha >= date_trunc('month', CURRENT_DATE)::date
      AND t.fecha  < (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month')::date
  )                                 AS aplicado
FROM public.gastos_recurrentes gr
WHERE gr.user_id   = auth.uid()
  AND gr.activo    = true
  AND gr.mes_inicio <= date_trunc('month', CURRENT_DATE)::date
  AND (gr.mes_fin IS NULL OR gr.mes_fin >= date_trunc('month', CURRENT_DATE)::date)

UNION ALL

SELECT
  cc.id,
  'cuota'::TEXT                     AS tipo_programado,
  cc.descripcion,
  cc.categoria,
  cc.monto_cuota,
  cc.dia_cobro,
  -- cuota_actual >= cuotas esperadas hasta este mes
  (
    cc.cuota_actual >= (
      (EXTRACT(YEAR  FROM CURRENT_DATE) - EXTRACT(YEAR  FROM cc.mes_inicio)) * 12 +
       EXTRACT(MONTH FROM CURRENT_DATE) - EXTRACT(MONTH FROM cc.mes_inicio)
    )
  )                                 AS aplicado
FROM public.compras_cuotas cc
WHERE cc.user_id          = auth.uid()
  AND cc.mes_inicio       <= CURRENT_DATE
  AND cc.cuota_actual      < cc.total_cuotas;

-- ── 2. Función RPC: auto-aplicar recurrentes del mes ────────
-- Inserta en transacciones los recurrentes activos cuyo dia_cobro
-- ya pasó en el mes actual y que NO tienen una transacción vinculada.
-- Idempotente: el WHERE NOT EXISTS previene duplicados.
CREATE OR REPLACE FUNCTION public.fn_auto_apply_recurrentes(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted INTEGER := 0;
  r          RECORD;
  v_mes_ini  DATE    := date_trunc('month', CURRENT_DATE)::DATE;
  v_mes_fin  DATE    := (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month')::DATE;
BEGIN
  FOR r IN
    SELECT gr.id, gr.monto, gr.categoria, gr.descripcion, gr.dia_cobro
    FROM public.gastos_recurrentes gr
    WHERE gr.user_id    = p_user_id
      AND gr.activo     = true
      AND gr.mes_inicio <= v_mes_ini
      AND (gr.mes_fin IS NULL OR gr.mes_fin >= v_mes_ini)
      AND gr.dia_cobro  <= EXTRACT(DAY FROM CURRENT_DATE)
      -- Solo si NO existe ya una transacción vinculada en el mes actual
      AND NOT EXISTS (
        SELECT 1
        FROM public.transacciones t
        WHERE t.gastos_recurrentes_id = gr.id
          AND t.activo = true
          AND t.fecha >= v_mes_ini
          AND t.fecha  < v_mes_fin
      )
  LOOP
    INSERT INTO public.transacciones (
      user_id,
      tipo,
      monto,
      categoria,
      descripcion,
      metodo_pago,
      fecha,
      moneda,
      tipo_cambio,
      es_gasto_unico,
      gastos_recurrentes_id,
      fuente,
      activo
    ) VALUES (
      p_user_id,
      'gasto',
      r.monto,
      r.categoria,
      r.descripcion,
      'efectivo',
      -- Clamp al último día del mes si dia_cobro > días disponibles
      LEAST(
        (v_mes_ini + (r.dia_cobro - 1) * INTERVAL '1 day')::DATE,
        (v_mes_fin  - INTERVAL '1 day')::DATE
      ),
      'PEN',
      1.0,
      false,
      r.id,
      'auto_recurrente',
      true
    );

    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN v_inserted;
END;
$$;

-- Permisos: solo usuarios autenticados pueden llamar la función
REVOKE ALL ON FUNCTION public.fn_auto_apply_recurrentes(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_auto_apply_recurrentes(UUID) TO authenticated;

-- ── 3. Ciclo de facturación: dia_cierre en tarjetas ─────────
ALTER TABLE public.tarjetas_credito
  ADD COLUMN IF NOT EXISTS dia_cierre INTEGER
    CHECK (dia_cierre BETWEEN 1 AND 31);

-- ── Verificación ──────────────────────────────────────────────
SELECT 'view' AS objeto, viewname AS nombre
FROM pg_views
WHERE schemaname = 'public' AND viewname = 'v_gastos_programados_mes'
UNION ALL
SELECT 'function', routine_name
FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_name = 'fn_auto_apply_recurrentes'
UNION ALL
SELECT 'column', column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'tarjetas_credito' AND column_name = 'dia_cierre';
