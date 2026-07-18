-- Fase 4 — Contador mensual de llamadas a Claude por usuario
-- Tope duro: si el usuario supera p_max en el mes, la Edge Function no llama a Claude
-- y registra la tx sin categoría sugerida (sin perder el gasto).

CREATE TABLE IF NOT EXISTS public.uso_ia (
  user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  año_mes  TEXT NOT NULL,   -- formato 'YYYY-MM'
  llamadas INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, año_mes)
);

-- Solo lectura propia; service_role escribe
ALTER TABLE public.uso_ia ENABLE ROW LEVEL SECURITY;
CREATE POLICY "uso_ia_select" ON public.uso_ia FOR SELECT USING (auth.uid() = user_id);

-- Función atómica: incrementa y devuelve true si aún está bajo el límite
CREATE OR REPLACE FUNCTION public.fn_check_ia_limit(
  p_user_id UUID,
  p_año_mes TEXT,
  p_max     INT
) RETURNS BOOLEAN
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE ok BOOLEAN;
BEGIN
  INSERT INTO public.uso_ia (user_id, año_mes, llamadas)
    VALUES (p_user_id, p_año_mes, 1)
  ON CONFLICT (user_id, año_mes) DO UPDATE
    SET llamadas = uso_ia.llamadas + 1;

  SELECT llamadas <= p_max INTO ok
    FROM public.uso_ia
   WHERE user_id = p_user_id AND año_mes = p_año_mes;

  RETURN ok;
END;
$$;
