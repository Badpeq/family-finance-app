-- Fase 4 — Métricas diarias de ingesta y alertas de tasa de error
-- pg_cron ya habilitado (paso 1.2)

-- Vista: estadísticas diarias de transacciones auto-ingestadas
CREATE OR REPLACE VIEW public.v_metricas_ingesta_diaria
  WITH (security_invoker = true)
AS
SELECT
  (creado_en AT TIME ZONE 'America/Lima')::DATE AS dia,
  COUNT(*)                                       AS total,
  COUNT(*) FILTER (WHERE estado = 'PENDIENTE_REVISION')  AS pendientes,
  COUNT(*) FILTER (WHERE auto_clasificado = true)        AS auto_clasificadas,
  COUNT(*) FILTER (WHERE estado = 'PROCESADO' AND auto_clasificado = true) AS procesadas_auto
FROM public.transacciones
WHERE fuente LIKE 'auto_%' AND activo = true
GROUP BY 1
ORDER BY 1 DESC;

-- Vista: errores de ingesta por día y tipo
CREATE OR REPLACE VIEW public.v_errores_ingesta_diaria
  WITH (security_invoker = true)
AS
SELECT
  (creado_en AT TIME ZONE 'America/Lima')::DATE AS dia,
  error_tipo,
  COUNT(*) AS total
FROM public.log_errores_ingesta
GROUP BY 1, 2
ORDER BY 1 DESC, 3 DESC;

-- Función: detecta si ayer la tasa de error superó el 20 % y lo registra en log
CREATE OR REPLACE FUNCTION public.fn_check_ingesta_health()
RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_ayer       DATE := current_date - 1;
  v_total      INT;
  v_errores    INT;
  v_tasa       NUMERIC;
BEGIN
  SELECT COALESCE(total, 0) INTO v_total
    FROM v_metricas_ingesta_diaria WHERE dia = v_ayer;

  SELECT COALESCE(SUM(total), 0) INTO v_errores
    FROM v_errores_ingesta_diaria WHERE dia = v_ayer;

  IF v_total > 0 THEN
    v_tasa := v_errores::NUMERIC / v_total;
    IF v_tasa > 0.20 THEN
      RAISE WARNING 'INGESTA HEALTH: tasa de error %.0f%% el %s (errores=%, total=%)',
        v_tasa * 100, v_ayer, v_errores, v_total;
    END IF;
  END IF;
END;
$$;

-- Cron diario a las 08:00 UTC (03:00 Lima)
SELECT cron.schedule(
  'check-ingesta-health',
  '0 8 * * *',
  $$SELECT public.fn_check_ingesta_health()$$
);
