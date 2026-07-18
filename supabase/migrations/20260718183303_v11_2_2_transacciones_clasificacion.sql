-- Paso 2.2 — Columnas de clasificación inteligente en transacciones
-- categoria_sugerida: lo que Claude propone cuando confianza < 0.90
-- confianza_ia:       0.00–1.00, confianza de Claude en la categoría
-- auto_clasificado:   true si la categoría fue asignada automáticamente (regla o IA ≥0.90)

ALTER TABLE public.transacciones
  ADD COLUMN IF NOT EXISTS categoria_sugerida TEXT,
  ADD COLUMN IF NOT EXISTS confianza_ia       NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS auto_clasificado   BOOLEAN DEFAULT false;
