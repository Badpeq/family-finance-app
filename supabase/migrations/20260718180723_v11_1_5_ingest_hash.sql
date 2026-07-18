-- Paso 1.5 — Deduplicación del pipeline de email
-- Evita insertar la misma transacción si el mismo correo llega dos veces

ALTER TABLE public.transacciones
  ADD COLUMN IF NOT EXISTS ingest_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_tx_ingest_hash
  ON public.transacciones (user_id, ingest_hash)
  WHERE ingest_hash IS NOT NULL;
