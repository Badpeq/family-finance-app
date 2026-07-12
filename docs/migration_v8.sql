-- migration_v8.sql — Módulo WhatsApp: Captura automática Yape / Plin
-- Ejecutar en Supabase SQL Editor → New query
-- Requiere: migration_v7.sql ya ejecutado

-- ── 1. Vincular número WhatsApp al perfil ────────────────────────────────
--    Separado de 'telefono' (login) porque el usuario podría tener
--    un número WhatsApp diferente al que usa para autenticarse.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS telefono_whatsapp TEXT;

-- Índice único: un número WA → un solo usuario
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_telefono_whatsapp
  ON public.profiles(telefono_whatsapp)
  WHERE telefono_whatsapp IS NOT NULL;

-- ── 2. operacion_id en transacciones (deduplicación idempotente) ──────────
--    El número de operación que aparece en el comprobante Yape/Plin.
--    UNIQUE por (user_id, operacion_id): mismo código no se puede insertar dos veces.
ALTER TABLE public.transacciones
  ADD COLUMN IF NOT EXISTS operacion_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transacciones_operacion_id
  ON public.transacciones(user_id, operacion_id)
  WHERE operacion_id IS NOT NULL;

-- ── 3. Índice en fuente para filtrar capturas WA rápido ──────────────────
CREATE INDEX IF NOT EXISTS idx_transacciones_fuente
  ON public.transacciones(fuente)
  WHERE fuente IS NOT NULL;

-- ── 4. Vista: transacciones sin categoría asignada (pendientes de review) ─
--    El dashboard puede usar esta vista para mostrar badge de "X por clasificar"
CREATE OR REPLACE VIEW public.v_pendientes_clasificacion AS
SELECT
  t.id,
  t.user_id,
  t.monto,
  t.descripcion,
  t.fecha,
  t.fuente,
  t.creado_en
FROM public.transacciones t
WHERE t.activo   = true
  AND t.categoria = 'Por clasificar'
  AND t.user_id   = auth.uid()
ORDER BY t.creado_en DESC;

-- ── Verificar ─────────────────────────────────────────────────────────────
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'transacciones'
  AND column_name IN ('operacion_id', 'fuente_raw', 'fuente')
ORDER BY column_name;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'profiles'
  AND column_name IN ('telefono', 'telefono_whatsapp')
ORDER BY column_name;
