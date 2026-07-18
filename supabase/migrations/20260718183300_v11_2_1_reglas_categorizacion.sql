-- Paso 2.1 — Tabla de reglas de categorización automática
-- Cada vez que el usuario confirma o corrige una categoría, se upsertea una regla
-- asociada al comercio normalizado. La segunda vez que aparece ese comercio, se
-- asigna la categoría directamente (sin esperar confianza de Claude).

CREATE EXTENSION IF NOT EXISTS unaccent;

-- Helper server-side para normalizar nombres de comercio
CREATE OR REPLACE FUNCTION public.fn_normalizar_comercio(p_comercio TEXT)
RETURNS TEXT
LANGUAGE SQL IMMUTABLE STRICT
SET search_path = public
AS $$
  SELECT lower(trim(unaccent(p_comercio)));
$$;

CREATE TABLE IF NOT EXISTS public.reglas_categorizacion (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  comercio_normalizado TEXT        NOT NULL,
  categoria            TEXT        NOT NULL,
  subcategoria_id      UUID        REFERENCES public.subcategorias(id) ON DELETE SET NULL,
  veces_aplicada       INT         NOT NULL DEFAULT 0,
  creado_en            TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, comercio_normalizado)
);

ALTER TABLE public.reglas_categorizacion ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reglas_all" ON public.reglas_categorizacion
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_reglas_user_comercio ON public.reglas_categorizacion (user_id, comercio_normalizado);
