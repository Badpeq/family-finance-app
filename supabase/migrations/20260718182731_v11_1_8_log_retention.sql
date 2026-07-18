-- Paso 1.8 — Retención de logs: purgar log_errores_ingesta con más de 60 días
-- pg_cron ya está habilitado (paso 1.2). Se programa a las 03:00 UTC todos los días.

SELECT cron.schedule(
  'purge-log-errores-ingesta',
  '0 3 * * *',
  $$DELETE FROM public.log_errores_ingesta WHERE creado_en < now() - INTERVAL '60 days'$$
);
