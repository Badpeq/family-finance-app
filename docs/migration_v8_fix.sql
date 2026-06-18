-- ── FIX migration_v8: ambiguous "categoria" column in fn_deuda_capas ─────────
-- Causa: RETURNS TABLE declara "categoria TEXT" como variable PL/pgSQL.
-- Las referencias sin alias en la CTE all_cats colisionaban con esa variable.
-- Solución: añadir alias explícito a cada SELECT dentro de all_cats.
-- ─────────────────────────────────────────────────────────────────────────────

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
  IF v_inicio = DATE_TRUNC('month', CURRENT_DATE)::DATE THEN
    v_dias_trans := GREATEST(1, EXTRACT(DAY FROM CURRENT_DATE)::INT);
  ELSE
    v_dias_trans := v_dias_mes;
  END IF;

  SET LOCAL row_security = off;

  RETURN QUERY
  WITH

  gastos_reales AS (
    SELECT
      t.categoria                                                            AS cat,
      SUM(CASE WHEN t.moneda = 'USD'
               THEN t.monto * COALESCE(t.tipo_cambio, 1)
               ELSE t.monto END)                                            AS total,
      SUM(CASE WHEN NOT COALESCE(t.es_gasto_unico, false)
               THEN CASE WHEN t.moneda = 'USD'
                         THEN t.monto * COALESCE(t.tipo_cambio, 1)
                         ELSE t.monto END
               ELSE 0 END)                                                  AS total_prorratable,
      SUM(CASE WHEN COALESCE(t.es_gasto_unico, false)
               THEN CASE WHEN t.moneda = 'USD'
                         THEN t.monto * COALESCE(t.tipo_cambio, 1)
                         ELSE t.monto END
               ELSE 0 END)                                                  AS total_unico
    FROM public.transacciones t
    WHERE t.user_id = v_uid
      AND t.tipo    = 'gasto'
      AND t.activo  = true
      AND t.fecha   >= v_inicio
      AND t.fecha   <= v_fin
    GROUP BY t.categoria
  ),

  recurrentes_pendientes AS (
    SELECT gr.categoria AS cat, SUM(gr.monto) AS total
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

  cuotas_mes AS (
    SELECT cc.categoria AS cat, SUM(cc.monto_cuota) AS total
    FROM public.compras_cuotas cc
    WHERE cc.user_id    = v_uid
      AND cc.mes_inicio <= v_inicio
      AND (
        ( EXTRACT(YEAR  FROM v_inicio) - EXTRACT(YEAR  FROM cc.mes_inicio) ) * 12
        + EXTRACT(MONTH FROM v_inicio) - EXTRACT(MONTH FROM cc.mes_inicio)
      ) < cc.total_cuotas
    GROUP BY cc.categoria
  ),

  -- FIX: todos los SELECT usan alias de tabla para evitar ambigüedad con la
  --      variable de salida "categoria" declarada en RETURNS TABLE
  all_cats AS (
    SELECT g.cat FROM gastos_reales           g
    UNION
    SELECT r.cat FROM recurrentes_pendientes  r
    UNION
    SELECT c.cat FROM cuotas_mes              c
  )

  SELECT
    ac.cat                                                            AS categoria,
    COALESCE(gr.total, 0)                                             AS deuda_real,
    COALESCE(gr.total, 0)
      + COALESCE(rp.total, 0)
      + COALESCE(cm.total, 0)                                         AS deuda_presupuestada,
    ROUND(
      (COALESCE(gr.total_prorratable, 0) / v_dias_trans * v_dias_mes)
      + COALESCE(gr.total_unico, 0)
      + COALESCE(rp.total, 0)
      + COALESCE(cm.total, 0)
    , 2)                                                              AS deuda_proyectada

  FROM all_cats ac
  LEFT JOIN gastos_reales          gr ON gr.cat = ac.cat
  LEFT JOIN recurrentes_pendientes rp ON rp.cat = ac.cat
  LEFT JOIN cuotas_mes             cm ON cm.cat = ac.cat
  ORDER BY 4 DESC NULLS LAST;   -- ordinal para evitar ambigüedad con var de salida
END;
$$;

-- Verificar que la función responde (retorna [] para usuario anónimo, OK)
-- SELECT * FROM public.fn_deuda_capas(CURRENT_DATE);
