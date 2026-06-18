-- ============================================================
-- MIGRACIÓN V8: Subcategorías · es_gasto_unico · fecha editable
--               Vista unificada de categorías · Log programados
--               Motor de tres capas de deuda
-- Ejecutar en Supabase SQL Editor → New query
-- Requiere: migration_v7.sql ya ejecutado
-- ============================================================

-- ── 1. TABLA SUBCATEGORÍAS ────────────────────────────────────────────────────
-- categoria_id → categorias_personalizadas (solo para categorías custom del usuario).
-- Para subcategorías de categorías base (Alimentación, etc.), categoria_id = NULL
-- y se usa categoria_nombre TEXT como referencia.
CREATE TABLE IF NOT EXISTS public.subcategorias (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  categoria_id     UUID        REFERENCES public.categorias_personalizadas(id) ON DELETE CASCADE,
  categoria_nombre TEXT,
  nombre           TEXT        NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT chk_subcategoria_cat CHECK (
    categoria_id IS NOT NULL OR categoria_nombre IS NOT NULL
  )
);

ALTER TABLE public.subcategorias ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'subcategorias' AND policyname = 'subcategorias_own'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "subcategorias_own" ON public.subcategorias
        FOR ALL
        USING (auth.uid() = user_id)
        WITH CHECK (auth.uid() = user_id)
    $p$;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_subcategorias_user   ON public.subcategorias(user_id);
CREATE INDEX IF NOT EXISTS idx_subcategorias_cat_id ON public.subcategorias(categoria_id);

-- ── 2. NUEVAS COLUMNAS EN TRANSACCIONES ──────────────────────────────────────

-- 2a. Subcategoría (nullable)
ALTER TABLE public.transacciones
  ADD COLUMN IF NOT EXISTS subcategoria_id UUID
    REFERENCES public.subcategorias(id) ON DELETE SET NULL;

-- 2b. Gasto único (no se prorratea en el run-rate diario)
ALTER TABLE public.transacciones
  ADD COLUMN IF NOT EXISTS es_gasto_unico BOOLEAN NOT NULL DEFAULT false;

-- 2c. Fecha de la transacción editable por el usuario (distinta de creado_en)
ALTER TABLE public.transacciones
  ADD COLUMN IF NOT EXISTS fecha DATE NOT NULL DEFAULT CURRENT_DATE;

-- Backfill: asignar a filas existentes la fecha de creado_en
UPDATE public.transacciones
  SET fecha = creado_en::DATE
  WHERE fecha = CURRENT_DATE
    AND creado_en::DATE <> CURRENT_DATE;

-- 2d. FKs hacia tablas de gastos programados (para el log de estado exacto)
ALTER TABLE public.transacciones
  ADD COLUMN IF NOT EXISTS gastos_recurrentes_id UUID
    REFERENCES public.gastos_recurrentes(id) ON DELETE SET NULL;

ALTER TABLE public.transacciones
  ADD COLUMN IF NOT EXISTS compras_cuotas_id UUID
    REFERENCES public.compras_cuotas(id) ON DELETE SET NULL;

-- ── 3. CONFIRMAR MUTABILIDAD DE fecha Y moneda VÍA UPDATE ────────────────────
-- La policy de migration_v2 ya cubre: FOR UPDATE USING (auth.uid() = user_id)
-- Si por algún motivo no existe, la recreamos aquí de forma idempotente.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'transacciones'
      AND cmd        = 'UPDATE'
      AND policyname = 'transacciones_update_own'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "transacciones_update_own" ON public.transacciones
        FOR UPDATE
        USING (auth.uid() = user_id)
        WITH CHECK (auth.uid() = user_id)
    $p$;
  END IF;
END $$;

-- ── 4. VISTA UNIFICADA DE CATEGORÍAS ─────────────────────────────────────────
-- security_invoker = true → corre con permisos del llamante (respeta RLS).
-- Tres fuentes unificadas sin duplicados:
--   a) Categorías base del sistema (siempre presentes)
--   b) Categorías en public.categorias_personalizadas del usuario
--   c) Claves de presupuesto_template guardadas por el onboarding que aún
--      no están en categorias_personalizadas
DROP VIEW IF EXISTS public.v_categorias;
CREATE VIEW public.v_categorias
  WITH (security_invoker = true)
AS

-- 4a. Categorías base
SELECT
  NULL::uuid  AS id,
  auth.uid()  AS user_id,
  nombre,
  icono,
  false       AS es_personalizada,
  0           AS sort_order
FROM (VALUES
  ('Alimentación', '🛒'),
  ('Transporte',   '🚗'),
  ('Vivienda',     '🏠'),
  ('Entretenimiento', '🎬'),
  ('Salud',        '💊'),
  ('Educación',    '📚'),
  ('Ropa',         '👕'),
  ('Servicios',    '⚡'),
  ('Restaurantes', '🍽️'),
  ('Otros',        '📦')
) AS b(nombre, icono)
WHERE auth.uid() IS NOT NULL

UNION ALL

-- 4b. Categorías personalizadas explícitas (excluyendo las que coinciden con base)
SELECT
  cp.id,
  cp.user_id,
  cp.nombre,
  cp.icono,
  cp.es_personalizada,
  1 AS sort_order
FROM public.categorias_personalizadas cp
WHERE cp.user_id = auth.uid()
  AND cp.nombre NOT IN (
    'Alimentación','Transporte','Vivienda','Entretenimiento','Salud',
    'Educación','Ropa','Servicios','Restaurantes','Otros'
  )

UNION ALL

-- 4c. Categorías del onboarding en presupuesto_template que aún no están
--     guardadas en categorias_personalizadas
SELECT
  NULL::uuid  AS id,
  p.id        AS user_id,
  t.key       AS nombre,
  '📦'        AS icono,
  true        AS es_personalizada,
  2           AS sort_order
FROM public.profiles p,
  jsonb_each_text(p.presupuesto_template) t(key, value)
WHERE p.id = auth.uid()
  AND t.key NOT IN (
    'Alimentación','Transporte','Vivienda','Entretenimiento','Salud',
    'Educación','Ropa','Servicios','Restaurantes','Otros'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.categorias_personalizadas
    WHERE user_id = auth.uid() AND nombre = t.key
  );

-- ── 5. VISTA LOG DE GASTOS PROGRAMADOS DEL MES ───────────────────────────────
-- Muestra el estado de cada gasto programado (recurrente / cuota) en el mes actual.
-- aplicado = true  → ya hay una transacción registrada que lo cubre.
-- aplicado = false → pendiente de registrar.
DROP VIEW IF EXISTS public.v_gastos_programados_mes;
CREATE VIEW public.v_gastos_programados_mes
  WITH (security_invoker = true)
AS

-- 5a. Gastos recurrentes activos este mes
SELECT
  gr.id,
  gr.user_id,
  'recurrente'::text                        AS tipo_programado,
  gr.descripcion,
  gr.categoria,
  gr.monto                                  AS monto_cuota,
  gr.dia_cobro,
  DATE_TRUNC('month', CURRENT_DATE)::date   AS mes_referencia,
  (
    -- Coincidencia exacta via FK
    EXISTS (
      SELECT 1 FROM public.transacciones t
      WHERE t.user_id                = gr.user_id
        AND t.activo                 = true
        AND t.gastos_recurrentes_id  = gr.id
        AND DATE_TRUNC('month', t.fecha) = DATE_TRUNC('month', CURRENT_DATE)
    )
    OR
    -- Coincidencia aproximada (categoría + monto ± 0.01) cuando el FK no está seteado
    EXISTS (
      SELECT 1 FROM public.transacciones t
      WHERE t.user_id                = gr.user_id
        AND t.activo                 = true
        AND t.tipo                   = 'gasto'
        AND t.categoria              = gr.categoria
        AND ABS(t.monto - gr.monto)  < 0.01
        AND t.gastos_recurrentes_id  IS NULL
        AND DATE_TRUNC('month', t.fecha) = DATE_TRUNC('month', CURRENT_DATE)
    )
  )                                         AS aplicado
FROM public.gastos_recurrentes gr
WHERE gr.user_id    = auth.uid()
  AND gr.mes_inicio <= DATE_TRUNC('month', CURRENT_DATE)
  AND (gr.mes_fin IS NULL OR gr.mes_fin >= DATE_TRUNC('month', CURRENT_DATE))

UNION ALL

-- 5b. Cuotas cuyo mes activo es el mes corriente
SELECT
  cc.id,
  cc.user_id,
  'cuota'::text,
  cc.descripcion,
  cc.categoria,
  cc.monto_cuota,
  cc.dia_cobro,
  DATE_TRUNC('month', CURRENT_DATE)::date,
  (
    EXISTS (
      SELECT 1 FROM public.transacciones t
      WHERE t.user_id            = cc.user_id
        AND t.activo             = true
        AND t.compras_cuotas_id  = cc.id
        AND DATE_TRUNC('month', t.fecha) = DATE_TRUNC('month', CURRENT_DATE)
    )
    OR
    EXISTS (
      SELECT 1 FROM public.transacciones t
      WHERE t.user_id            = cc.user_id
        AND t.activo             = true
        AND t.tipo               = 'gasto'
        AND t.categoria          = cc.categoria
        AND ABS(t.monto - cc.monto_cuota) < 0.01
        AND t.compras_cuotas_id  IS NULL
        AND DATE_TRUNC('month', t.fecha) = DATE_TRUNC('month', CURRENT_DATE)
    )
  ) AS aplicado
FROM public.compras_cuotas cc
WHERE cc.user_id    = auth.uid()
  AND cc.mes_inicio <= DATE_TRUNC('month', CURRENT_DATE)
  -- Todavía dentro del rango de cuotas (número de meses desde inicio < total_cuotas)
  AND (
    ( EXTRACT(YEAR  FROM DATE_TRUNC('month', CURRENT_DATE))
      - EXTRACT(YEAR  FROM cc.mes_inicio) ) * 12
    + EXTRACT(MONTH FROM DATE_TRUNC('month', CURRENT_DATE))
    - EXTRACT(MONTH FROM cc.mes_inicio)
  ) < cc.total_cuotas;

-- ── 6. FUNCIÓN MOTOR DE TRES CAPAS DE DEUDA ──────────────────────────────────
-- Invocación desde el cliente:
--   supabase.rpc('fn_deuda_capas', { p_mes: '2026-06-01' })
--
-- Devuelve una fila por categoría con:
--   deuda_real         → gastos ya registrados en transacciones del mes
--   deuda_presupuestada→ real + cuotas del mes + recurrentes AÚN no aplicados
--   deuda_proyectada   → run-rate: (no_único/días_trans × días_mes) + único + recurrentes + cuotas
CREATE OR REPLACE FUNCTION public.fn_deuda_capas(p_mes DATE)
RETURNS TABLE (
  categoria           TEXT,
  deuda_real          NUMERIC,
  deuda_presupuestada NUMERIC,
  deuda_proyectada    NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid        UUID  := auth.uid();
  v_inicio     DATE  := DATE_TRUNC('month', p_mes)::DATE;
  v_fin        DATE  := (DATE_TRUNC('month', p_mes) + INTERVAL '1 month - 1 day')::DATE;
  v_dias_mes   INT   := EXTRACT(DAY FROM v_fin)::INT;
  v_dias_trans INT;
BEGIN
  -- Para el mes en curso, usar días reales transcurridos; para meses pasados, mes completo
  IF v_inicio = DATE_TRUNC('month', CURRENT_DATE)::DATE THEN
    v_dias_trans := GREATEST(1, EXTRACT(DAY FROM CURRENT_DATE)::INT);
  ELSE
    v_dias_trans := v_dias_mes;
  END IF;

  -- Necesario porque SECURITY DEFINER no propaga auth.uid() en algunas tablas con RLS
  SET LOCAL row_security = off;

  RETURN QUERY
  WITH

  -- ── Capa 1: Transacciones reales del mes ─────────────────────────────────
  gastos_reales AS (
    SELECT
      t.categoria,
      -- Total completo (en PEN)
      SUM(
        CASE WHEN t.moneda = 'USD'
             THEN t.monto * COALESCE(t.tipo_cambio, 1)
             ELSE t.monto END
      ) AS total,
      -- Solo los no-únicos (prorratables en el run-rate)
      SUM(
        CASE WHEN NOT COALESCE(t.es_gasto_unico, false)
             THEN CASE WHEN t.moneda = 'USD'
                       THEN t.monto * COALESCE(t.tipo_cambio, 1)
                       ELSE t.monto END
             ELSE 0 END
      ) AS total_prorratable,
      -- Solo los únicos (van directo al proyectado sin prorratear)
      SUM(
        CASE WHEN COALESCE(t.es_gasto_unico, false)
             THEN CASE WHEN t.moneda = 'USD'
                       THEN t.monto * COALESCE(t.tipo_cambio, 1)
                       ELSE t.monto END
             ELSE 0 END
      ) AS total_unico
    FROM public.transacciones t
    WHERE t.user_id = v_uid
      AND t.tipo    = 'gasto'
      AND t.activo  = true
      AND t.fecha   >= v_inicio
      AND t.fecha   <= v_fin
    GROUP BY t.categoria
  ),

  -- ── Recurrentes del mes que AÚN no tienen transacción registrada ─────────
  recurrentes_pendientes AS (
    SELECT gr.categoria, SUM(gr.monto) AS total
    FROM public.gastos_recurrentes gr
    WHERE gr.user_id    = v_uid
      AND gr.mes_inicio <= v_inicio
      AND (gr.mes_fin IS NULL OR gr.mes_fin >= v_inicio)
      AND NOT EXISTS (
        SELECT 1 FROM public.transacciones t
        WHERE t.user_id = v_uid
          AND t.activo  = true
          AND t.fecha   >= v_inicio
          AND t.fecha   <= v_fin
          AND (
            t.gastos_recurrentes_id = gr.id
            OR (t.categoria = gr.categoria
                AND ABS(t.monto - gr.monto) < 0.01
                AND t.gastos_recurrentes_id IS NULL)
          )
      )
    GROUP BY gr.categoria
  ),

  -- ── Cuotas activas este mes ───────────────────────────────────────────────
  cuotas_mes AS (
    SELECT cc.categoria, SUM(cc.monto_cuota) AS total
    FROM public.compras_cuotas cc
    WHERE cc.user_id    = v_uid
      AND cc.mes_inicio <= v_inicio
      AND (
        ( EXTRACT(YEAR  FROM v_inicio) - EXTRACT(YEAR  FROM cc.mes_inicio) ) * 12
        + EXTRACT(MONTH FROM v_inicio) - EXTRACT(MONTH FROM cc.mes_inicio)
      ) < cc.total_cuotas
    GROUP BY cc.categoria
  ),

  -- ── Unión de todas las categorías con datos este mes ─────────────────────
  all_cats AS (
    SELECT categoria FROM gastos_reales
    UNION SELECT categoria FROM recurrentes_pendientes
    UNION SELECT categoria FROM cuotas_mes
  )

  SELECT
    ac.categoria,

    -- Capa 1: Deuda real (solo lo ya registrado en transacciones)
    COALESCE(gr.total, 0) AS deuda_real,

    -- Capa 2: Deuda presupuestada = real + cuotas + recurrentes pendientes
    COALESCE(gr.total, 0)
      + COALESCE(rp.total, 0)
      + COALESCE(cm.total, 0) AS deuda_presupuestada,

    -- Capa 3: Deuda proyectada (run-rate diario)
    -- = (prorratable / días_trans × días_mes) + único + recurrentes + cuotas
    ROUND(
      (COALESCE(gr.total_prorratable, 0) / v_dias_trans * v_dias_mes)
      + COALESCE(gr.total_unico, 0)
      + COALESCE(rp.total, 0)
      + COALESCE(cm.total, 0)
    , 2) AS deuda_proyectada

  FROM all_cats ac
  LEFT JOIN gastos_reales          gr ON gr.categoria = ac.categoria
  LEFT JOIN recurrentes_pendientes rp ON rp.categoria = ac.categoria
  LEFT JOIN cuotas_mes             cm ON cm.categoria = ac.categoria
  ORDER BY deuda_proyectada DESC NULLS LAST;
END;
$$;

-- ── VERIFICACIÓN ─────────────────────────────────────────────────────────────
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'transacciones'
  AND column_name  IN (
    'subcategoria_id', 'es_gasto_unico', 'fecha',
    'gastos_recurrentes_id', 'compras_cuotas_id'
  )
ORDER BY column_name;

SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'subcategorias';

SELECT viewname FROM pg_views
WHERE schemaname = 'public'
  AND viewname   IN ('v_categorias', 'v_gastos_programados_mes');

SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_name = 'fn_deuda_capas';
