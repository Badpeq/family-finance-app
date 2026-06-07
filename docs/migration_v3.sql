-- ============================================================
-- MIGRACIÓN V3: Presupuestos + Fix duplicidad ahorros
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- ── 1. Tabla presupuestos ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.presupuestos (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID        REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  categoria    TEXT        NOT NULL,
  monto_limite NUMERIC(12, 2) NOT NULL CHECK (monto_limite > 0),
  periodo      DATE        NOT NULL, -- primer día del mes: '2026-06-01'
  creado_en    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, categoria, periodo)
);

ALTER TABLE public.presupuestos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "presupuestos_all_own" ON public.presupuestos;
CREATE POLICY "presupuestos_all_own" ON public.presupuestos
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── 2. RLS UPDATE para cuentas_ahorro ───────────────────────
-- Necesario para editar nombre y saldo desde el frontend
DROP POLICY IF EXISTS "cuentas_ahorro_update_own" ON public.cuentas_ahorro;
CREATE POLICY "cuentas_ahorro_update_own" ON public.cuentas_ahorro
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── 3. Eliminar triggers duplicados en ahorros_inversiones ──
-- El trigger de la migración V1/original (fn_apply_ahorro o similar)
-- más el nuestro (fn_update_saldo_ahorro) causaban doble impacto.
DROP TRIGGER IF EXISTS trg_ahorro                ON public.ahorros_inversiones;
DROP TRIGGER IF EXISTS trg_apply_ahorro          ON public.ahorros_inversiones;
DROP TRIGGER IF EXISTS handle_ahorro             ON public.ahorros_inversiones;
DROP TRIGGER IF EXISTS on_ahorro_insert          ON public.ahorros_inversiones;
DROP TRIGGER IF EXISTS trg_ahorro_saldo          ON public.ahorros_inversiones;
DROP TRIGGER IF EXISTS trg_saldo_ahorro          ON public.ahorros_inversiones;
DROP TRIGGER IF EXISTS update_saldo_on_ahorro    ON public.ahorros_inversiones;

DROP FUNCTION IF EXISTS public.fn_apply_ahorro();

-- ── 4. Diagnóstico — correr para ver si quedó algún duplicado:
-- SELECT trigger_name, event_object_table, action_statement
-- FROM information_schema.triggers
-- WHERE trigger_schema = 'public'
--   AND event_object_table = 'ahorros_inversiones'
-- ORDER BY trigger_name;
-- Solo deben aparecer: trg_tx_from_ahorro y trg_update_saldo_ahorro
