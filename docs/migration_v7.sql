-- migration_v7.sql — Desglose granular de tickets y vouchers
-- Ejecutar en Supabase SQL Editor → New query
-- Requiere: migration_v6.sql ya ejecutado

-- ── 1. Tabla de detalles de transacción (líneas de ticket) ────────────────
CREATE TABLE IF NOT EXISTS public.transaccion_detalles (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  transaccion_id   UUID        NOT NULL REFERENCES public.transacciones(id) ON DELETE CASCADE,
  producto         TEXT        NOT NULL,
  cantidad         NUMERIC     NOT NULL DEFAULT 1,
  precio_unitario  NUMERIC     NOT NULL,
  precio_total     NUMERIC     NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.transaccion_detalles ENABLE ROW LEVEL SECURITY;

-- RLS: el usuario solo accede a detalles de SUS transacciones
CREATE POLICY "usuario_lee_sus_detalles"
  ON public.transaccion_detalles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.transacciones t
      WHERE t.id = transaccion_detalles.transaccion_id
        AND t.user_id = auth.uid()
    )
  );

CREATE POLICY "usuario_inserta_sus_detalles"
  ON public.transaccion_detalles FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.transacciones t
      WHERE t.id = transaccion_detalles.transaccion_id
        AND t.user_id = auth.uid()
    )
  );

CREATE POLICY "usuario_elimina_sus_detalles"
  ON public.transaccion_detalles FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.transacciones t
      WHERE t.id = transaccion_detalles.transaccion_id
        AND t.user_id = auth.uid()
    )
  );

-- ── 2. Índices de rendimiento ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tx_detalles_transaccion_id
  ON public.transaccion_detalles(transaccion_id);

CREATE INDEX IF NOT EXISTS idx_tx_detalles_producto
  ON public.transaccion_detalles(producto text_pattern_ops);

-- ── 3. Campo fuente_raw en transacciones (texto original pegado) ──────────
ALTER TABLE public.transacciones
  ADD COLUMN IF NOT EXISTS fuente_raw TEXT;

-- ── Verificar ─────────────────────────────────────────────────────────────
SELECT
  column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('transacciones', 'transaccion_detalles')
  AND column_name IN ('fuente_raw','id','producto','precio_unitario')
ORDER BY table_name, column_name;
