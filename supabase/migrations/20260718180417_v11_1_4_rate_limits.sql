-- Paso 1.4 — Rate limiting en Edge Functions
-- Tabla ligera + función SECURITY DEFINER para proteger el presupuesto de Claude

CREATE TABLE IF NOT EXISTS public.rate_limits (
  clave          TEXT        PRIMARY KEY,
  ventana_inicio TIMESTAMPTZ NOT NULL DEFAULT now(),
  contador       INT         NOT NULL DEFAULT 1
);

-- Sin RLS: solo service_role puede acceder (la función usa SECURITY DEFINER)
ALTER TABLE public.rate_limits DISABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.fn_check_rate_limit(
  p_clave   TEXT,
  p_max     INT,
  p_ventana INTERVAL
) RETURNS BOOLEAN
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE ok BOOLEAN;
BEGIN
  INSERT INTO public.rate_limits (clave)
    VALUES (p_clave)
  ON CONFLICT (clave) DO UPDATE SET
    contador       = CASE
                       WHEN rate_limits.ventana_inicio < now() - p_ventana THEN 1
                       ELSE rate_limits.contador + 1
                     END,
    ventana_inicio = CASE
                       WHEN rate_limits.ventana_inicio < now() - p_ventana THEN now()
                       ELSE rate_limits.ventana_inicio
                     END;

  SELECT contador <= p_max INTO ok
    FROM public.rate_limits
   WHERE clave = p_clave;

  RETURN ok;
END;
$$;
