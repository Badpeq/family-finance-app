-- ============================================================
-- MIGRACIÓN V10: Ingesta automática de transacciones
-- Canal: Correos Gmail + Notificaciones push (Make / n8n / MacroDroid)
-- Ejecutar en Supabase SQL Editor → New query
-- Requiere: migration_v9.sql ya ejecutado
-- ============================================================

-- ── 1. ultimos_4 en tarjetas_credito ────────────────────────
--    Dígitos finales de la tarjeta. La IA los extrae del texto
--    del correo/notificación y este campo permite el matching.
ALTER TABLE public.tarjetas_credito
  ADD COLUMN IF NOT EXISTS ultimos_4 VARCHAR(4);

-- Índice para el lookup rápido dentro del mismo user
CREATE INDEX IF NOT EXISTS idx_tarjetas_ultimos_4
  ON public.tarjetas_credito(user_id, ultimos_4)
  WHERE ultimos_4 IS NOT NULL;

-- ── 2. estado en transacciones ───────────────────────────────
--    MANUAL:             ingresado directamente por el usuario (default histórico)
--    PENDIENTE_REVISION: capturado automáticamente, espera confirmación del usuario
--    PROCESADO:          usuario confirmó el gasto auto-capturado
ALTER TABLE public.transacciones
  ADD COLUMN IF NOT EXISTS estado TEXT DEFAULT 'MANUAL'
    CHECK (estado IN ('MANUAL', 'PENDIENTE_REVISION', 'PROCESADO'));

-- Índice para que el badge "pendientes" sea rápido
CREATE INDEX IF NOT EXISTS idx_transacciones_estado
  ON public.transacciones(user_id, estado)
  WHERE estado = 'PENDIENTE_REVISION';

-- ── 3. Tabla de tokens de ingesta ────────────────────────────
--    Un token por dispositivo/servicio. Mapea token → user_id.
--    Esto permite que Make, n8n y MacroDroid usen tokens distintos
--    y que revocarlos no afecte a los otros.
CREATE TABLE IF NOT EXISTS public.ingest_tokens (
  token       TEXT        PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  descripcion TEXT,
  activo      BOOLEAN     NOT NULL DEFAULT true,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_uso  TIMESTAMPTZ
);

ALTER TABLE public.ingest_tokens ENABLE ROW LEVEL SECURITY;

-- El usuario solo puede ver y gestionar sus propios tokens
CREATE POLICY "ingest_tokens_own"
  ON public.ingest_tokens
  FOR ALL
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── 4. Tabla de log de errores de ingesta ────────────────────
--    Si la IA no puede parsear o el insert falla, el raw_text
--    se guarda aquí para recuperación manual / depuración.
CREATE TABLE IF NOT EXISTS public.log_errores_ingesta (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  token          TEXT,                      -- qué token envió la petición (para trazar user)
  source         TEXT        NOT NULL,      -- 'email' | 'notification'
  raw_text       TEXT        NOT NULL,      -- texto original recibido
  error_tipo     TEXT        NOT NULL,      -- 'PARSE_FAILED' | 'NO_MONTO' | 'INSERT_FAILED' | 'VALIDATION_FAILED'
  error_msg      TEXT,
  parsed_partial JSONB,                     -- resultado parcial de la IA si lo hubo
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sin RLS: solo service_role puede escribir/leer (edge function)
ALTER TABLE public.log_errores_ingesta ENABLE ROW LEVEL SECURITY;
-- No se crean políticas: los usuarios no acceden directamente a esta tabla

-- ── 5. Actualizar v_pendientes_clasificacion ─────────────────
--    Ahora incluye también las transacciones auto-capturadas
--    que esperan confirmación del usuario.
CREATE OR REPLACE VIEW public.v_pendientes_clasificacion AS
SELECT
  t.id,
  t.user_id,
  t.monto,
  t.moneda,
  t.descripcion,
  t.categoria,
  t.fecha,
  t.fuente,
  t.estado,
  t.fuente_raw,
  t.creado_en
FROM public.transacciones t
WHERE t.activo  = true
  AND t.user_id = auth.uid()
  AND (
    t.categoria = 'Por clasificar'
    OR t.estado = 'PENDIENTE_REVISION'
  )
ORDER BY t.creado_en DESC;

-- ── Verificación ──────────────────────────────────────────────
SELECT 'tarjetas_credito.ultimos_4'         AS check, column_name IS NOT NULL AS ok
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'tarjetas_credito' AND column_name = 'ultimos_4'
UNION ALL
SELECT 'transacciones.estado', column_name IS NOT NULL
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'transacciones' AND column_name = 'estado'
UNION ALL
SELECT 'ingest_tokens table', to_regclass('public.ingest_tokens') IS NOT NULL
UNION ALL
SELECT 'log_errores_ingesta table', to_regclass('public.log_errores_ingesta') IS NOT NULL;
