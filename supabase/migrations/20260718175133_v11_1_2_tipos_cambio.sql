-- Paso 1.2 — Blindar tipos_cambio
-- Solo lectura para usuarios; escritura únicamente vía service_role (Edge Function con cron)

-- Extensiones necesarias para el cron HTTP
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

-- Eliminar políticas de escritura (cualquier usuario autenticado podía envenenar la tabla)
DROP POLICY IF EXISTS "tc_insert" ON public.tipos_cambio;
DROP POLICY IF EXISTS "tc_update" ON public.tipos_cambio;

-- Mantener solo lectura; reemplazar política antigua por forma estándar
DROP POLICY IF EXISTS "tc_select" ON public.tipos_cambio;
CREATE POLICY "tc_select" ON public.tipos_cambio
  FOR SELECT TO authenticated USING (true);

-- Job diario a las 9:00 UTC para actualizar el tipo de cambio
SELECT cron.schedule(
  'actualizar-tc',
  '0 9 * * *',
  $$ SELECT net.http_post(
       url     := 'https://tsdawpxiqqnesikcqlex.supabase.co/functions/v1/actualizar-tipo-cambio',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body    := '{}'::jsonb
     ) $$
);
