-- Paso 2.7 — Token de push notifications de Expo
-- La app registra el token al iniciar; la Edge Function lo usa para enviar alertas.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS expo_push_token TEXT;
