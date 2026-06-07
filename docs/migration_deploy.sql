-- ============================================================
-- MIGRACIÓN DEPLOY: Setup inicial para nuevos usuarios
-- Ejecutar UNA SOLA VEZ en Supabase SQL Editor con rol postgres
-- antes de compartir la app con amigos.
-- ============================================================

-- ── 1. Tabla profiles (si no existe) ────────────────────────
-- Supabase no crea esta tabla automáticamente; es nuestra extensión
-- del usuario de auth.
CREATE TABLE IF NOT EXISTS public.profiles (
  id                UUID        PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  nombre            TEXT,
  apellido          TEXT,
  telefono          TEXT,
  moneda_base       VARCHAR(3)  NOT NULL DEFAULT 'PEN',
  perfil_completado BOOLEAN     NOT NULL DEFAULT false,
  creado_en         TIMESTAMPTZ          DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_all_own" ON public.profiles;
CREATE POLICY "profiles_all_own" ON public.profiles
  FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- ── 2. Trigger: auto-crear perfil al registrarse ─────────────
-- Cada vez que Supabase crea un usuario en auth.users,
-- este trigger inserta un perfil vacío en public.profiles.
-- ON CONFLICT DO NOTHING evita errores si se dispara dos veces.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, telefono, perfil_completado)
  VALUES (NEW.id, NEW.phone, false)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ── 3. Backfill: crear perfil para usuarios ya existentes ────
-- Solo necesario si ya tienes cuentas registradas antes de esta migración.
-- Inserta un perfil vacío para cualquier usuario que no tenga uno.
INSERT INTO public.profiles (id, telefono, perfil_completado)
SELECT id, phone, false
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.profiles)
ON CONFLICT (id) DO NOTHING;

-- ── 4. Verificación ─────────────────────────────────────────
-- Confirma que el trigger existe y que todos los usuarios tienen perfil:
SELECT trigger_name, event_object_table, action_timing, event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name = 'on_auth_user_created';

SELECT
  u.id,
  u.phone,
  u.created_at,
  p.perfil_completado
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
ORDER BY u.created_at DESC;
