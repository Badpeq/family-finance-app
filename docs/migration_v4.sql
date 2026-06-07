-- ============================================================
-- MIGRACIÓN V4: Soporte multi-moneda (PEN / USD)
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- ── 1. Columna moneda en tablas de productos ─────────────────
ALTER TABLE public.cuentas_ahorro
  ADD COLUMN IF NOT EXISTS moneda VARCHAR(3) NOT NULL DEFAULT 'PEN';

ALTER TABLE public.tarjetas_credito
  ADD COLUMN IF NOT EXISTS moneda VARCHAR(3) NOT NULL DEFAULT 'PEN';

-- ── 2. Columnas en transacciones ─────────────────────────────
-- moneda: la moneda en que se ingresó la transacción
-- tipo_cambio: tasa PEN/USD vigente al momento del registro
ALTER TABLE public.transacciones
  ADD COLUMN IF NOT EXISTS moneda VARCHAR(3) NOT NULL DEFAULT 'PEN';

ALTER TABLE public.transacciones
  ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(8,4) NOT NULL DEFAULT 1.0000;

-- ── 3. Columnas en ahorros_inversiones ───────────────────────
-- moneda_original: moneda en que el usuario ingresó el monto
-- tipo_cambio: tasa usada para convertir al idioma nativo de la cuenta
ALTER TABLE public.ahorros_inversiones
  ADD COLUMN IF NOT EXISTS moneda_original VARCHAR(3) NOT NULL DEFAULT 'PEN';

ALTER TABLE public.ahorros_inversiones
  ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(8,4) NOT NULL DEFAULT 1.0000;

-- ── 4. Tabla tipos_cambio (caché diario) ─────────────────────
CREATE TABLE IF NOT EXISTS public.tipos_cambio (
  id        UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  fecha     DATE    UNIQUE NOT NULL,
  compra    NUMERIC(8,4) NOT NULL,
  venta     NUMERIC(8,4) NOT NULL,
  fuente    TEXT    DEFAULT 'api',
  creado_en TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.tipos_cambio ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tc_select" ON public.tipos_cambio;
DROP POLICY IF EXISTS "tc_insert" ON public.tipos_cambio;
DROP POLICY IF EXISTS "tc_update" ON public.tipos_cambio;

-- Cualquier usuario autenticado puede leer y escribir la tasa del día
CREATE POLICY "tc_select" ON public.tipos_cambio
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "tc_insert" ON public.tipos_cambio
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "tc_update" ON public.tipos_cambio
  FOR UPDATE USING (auth.role() = 'authenticated');

-- ── 5. Verificación ─────────────────────────────────────────
SELECT
  table_name,
  column_name,
  data_type,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('cuentas_ahorro','tarjetas_credito','transacciones','ahorros_inversiones')
  AND column_name IN ('moneda','moneda_original','tipo_cambio')
ORDER BY table_name, column_name;
