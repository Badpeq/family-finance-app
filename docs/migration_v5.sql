-- migration_v5.sql
-- Ejecutar en Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Requiere: migration_v2.sql ya ejecutado

-- ── Nuevas columnas en profiles ────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ingreso_mensual      NUMERIC,
  ADD COLUMN IF NOT EXISTS presupuesto_template JSONB    DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS modulo_ahorros       BOOLEAN  DEFAULT false,
  ADD COLUMN IF NOT EXISTS modulo_prestamos     BOOLEAN  DEFAULT false;

-- ── Índice para el template (consultas por user_id ya cubiertas por PK) ────
-- No se necesita índice adicional; presupuesto_template se lee junto al perfil.

-- ── Verificar resultado ─────────────────────────────────────────────────────
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'profiles'
  AND column_name  IN ('ingreso_mensual','presupuesto_template','modulo_ahorros','modulo_prestamos');
