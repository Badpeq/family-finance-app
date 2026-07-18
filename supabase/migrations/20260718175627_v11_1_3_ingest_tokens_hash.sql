-- Paso 1.3 — Hashear tokens de ingesta
-- Elimina el bearer en texto plano de la DB; solo se guarda el SHA-256

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Agregar las columnas nuevas
ALTER TABLE public.ingest_tokens
  ADD COLUMN id        UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN token_hash TEXT,
  ADD COLUMN expira_en  TIMESTAMPTZ;

-- 2. Migrar los tokens existentes al hash
UPDATE public.ingest_tokens
  SET token_hash = encode(digest(token, 'sha256'), 'hex');

-- 3. Aplicar restricciones
ALTER TABLE public.ingest_tokens
  ALTER COLUMN token_hash SET NOT NULL;

ALTER TABLE public.ingest_tokens
  ADD CONSTRAINT ingest_tokens_hash_uk UNIQUE (token_hash);

-- 4. Cambiar la clave primaria: de token (texto) a id (uuid)
ALTER TABLE public.ingest_tokens
  DROP CONSTRAINT ingest_tokens_pkey;

ALTER TABLE public.ingest_tokens
  ADD CONSTRAINT ingest_tokens_pkey PRIMARY KEY (id);

-- 5. Eliminar la columna con el texto plano
ALTER TABLE public.ingest_tokens
  DROP COLUMN token;

-- Nota: log_errores_ingesta.token (TEXT) pasa a guardar token_hash en adelante;
-- no requiere cambio de esquema (mismo tipo TEXT).
