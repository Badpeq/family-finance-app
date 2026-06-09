-- migration_v6.sql
-- Ejecutar en Supabase SQL Editor → New query
-- Requiere: migration_v5.sql ya ejecutado

-- ── 1. Seguimiento diario en presupuestos ───────────────────────────────────
ALTER TABLE public.presupuestos
  ADD COLUMN IF NOT EXISTS seguimiento_diario BOOLEAN DEFAULT false;

-- ── 2. Módulo tarjetas de crédito en profiles ───────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS modulo_tarjetas BOOLEAN DEFAULT true;

-- ── 3. Tabla de categorías personalizadas ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.categorias_personalizadas (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre           TEXT        NOT NULL,
  icono            TEXT        NOT NULL DEFAULT '📦',
  es_personalizada BOOLEAN     DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.categorias_personalizadas ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'categorias_personalizadas'
      AND policyname = 'usuarios_ven_sus_categorias'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "usuarios_ven_sus_categorias"
        ON public.categorias_personalizadas
        FOR ALL
        USING (auth.uid() = user_id)
        WITH CHECK (auth.uid() = user_id)
    $p$;
  END IF;
END $$;

-- ── Verificar ────────────────────────────────────────────────────────────────
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'presupuestos'
  AND column_name = 'seguimiento_diario';

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'profiles'
  AND column_name = 'modulo_tarjetas';

SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'categorias_personalizadas';
