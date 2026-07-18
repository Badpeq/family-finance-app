-- ============================================================
-- V12: MODO HOGAR
-- ============================================================

-- 2.1 Tablas base -------------------------------------------------
CREATE TABLE public.hogares (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre            TEXT NOT NULL CHECK (length(nombre) BETWEEN 1 AND 60),
  admin_id          UUID NOT NULL REFERENCES auth.users(id),
  codigo_invitacion TEXT NOT NULL UNIQUE
                    DEFAULT upper(substr(md5(random()::text), 1, 8)),
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.hogar_miembros (
  hogar_id  UUID NOT NULL REFERENCES public.hogares(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rol       TEXT NOT NULL DEFAULT 'miembro' CHECK (rol IN ('admin','miembro')),
  estado    TEXT NOT NULL DEFAULT 'pendiente'
            CHECK (estado IN ('pendiente','activo','removido')),
  unido_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (hogar_id, user_id)
);
-- Un usuario solo puede estar activo/pendiente en UN hogar (V12)
CREATE UNIQUE INDEX ux_miembro_un_hogar ON public.hogar_miembros (user_id)
  WHERE estado IN ('pendiente','activo');

CREATE TABLE public.hogar_modulos (
  hogar_id       UUID NOT NULL REFERENCES public.hogares(id) ON DELETE CASCADE,
  modulo         TEXT NOT NULL CHECK (modulo IN
    ('transacciones','presupuestos','tarjetas','prestamos',
     'ahorros','recurrentes','cuotas')),
  habilitado     BOOLEAN NOT NULL DEFAULT false,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (hogar_id, modulo)
);

-- 2.2 Columnas en tablas compartibles ----------------------------
ALTER TABLE public.transacciones
  ADD COLUMN IF NOT EXISTS hogar_id UUID REFERENCES public.hogares(id),
  ADD COLUMN IF NOT EXISTS privado  BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.presupuestos
  ADD COLUMN IF NOT EXISTS hogar_id UUID REFERENCES public.hogares(id);

ALTER TABLE public.tarjetas_credito
  ADD COLUMN IF NOT EXISTS hogar_id UUID REFERENCES public.hogares(id);

ALTER TABLE public.prestamos
  ADD COLUMN IF NOT EXISTS hogar_id UUID REFERENCES public.hogares(id);

ALTER TABLE public.cuentas_ahorro
  ADD COLUMN IF NOT EXISTS hogar_id UUID REFERENCES public.hogares(id);

ALTER TABLE public.gastos_recurrentes
  ADD COLUMN IF NOT EXISTS hogar_id UUID REFERENCES public.hogares(id);

ALTER TABLE public.compras_cuotas
  ADD COLUMN IF NOT EXISTS hogar_id UUID REFERENCES public.hogares(id);

CREATE INDEX ix_tx_hogar ON public.transacciones (hogar_id)
  WHERE hogar_id IS NOT NULL;

-- 2.3 Funciones helper (SECURITY DEFINER = sin recursion RLS) ----
CREATE OR REPLACE FUNCTION public.fn_mi_hogar()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT hogar_id FROM public.hogar_miembros
  WHERE user_id = auth.uid() AND estado = 'activo' LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.fn_es_admin_hogar(p_hogar UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.hogares WHERE id = p_hogar AND admin_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.fn_modulo_liberado(p_hogar UUID, p_modulo TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT habilitado FROM public.hogar_modulos
     WHERE hogar_id = p_hogar AND modulo = p_modulo), false);
$$;

-- 2.4 RLS de las tablas nuevas ------------------------------------
ALTER TABLE public.hogares        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hogar_miembros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hogar_modulos  ENABLE ROW LEVEL SECURITY;

-- hogares: lo ven sus miembros (cualquier estado); solo el admin lo edita
CREATE POLICY "hogares_select" ON public.hogares FOR SELECT USING (
  admin_id = auth.uid()
  OR id IN (SELECT hogar_id FROM public.hogar_miembros WHERE user_id = auth.uid())
);
CREATE POLICY "hogares_insert" ON public.hogares FOR INSERT
  WITH CHECK (admin_id = auth.uid());
CREATE POLICY "hogares_update" ON public.hogares FOR UPDATE
  USING (admin_id = auth.uid());

-- hogar_miembros: cada quien ve su fila; el admin ve y gestiona todas
-- Usamos fn_es_admin_hogar() para evitar recursion RLS (CLAUDE.md requirement)
CREATE POLICY "hm_select" ON public.hogar_miembros FOR SELECT USING (
  user_id = auth.uid() OR fn_es_admin_hogar(hogar_id)
);
CREATE POLICY "hm_update_admin" ON public.hogar_miembros FOR UPDATE
  USING (fn_es_admin_hogar(hogar_id));
CREATE POLICY "hm_delete_self" ON public.hogar_miembros FOR DELETE
  USING (user_id = auth.uid());

-- hogar_modulos: miembros activos leen; solo el admin escribe
CREATE POLICY "modulos_select" ON public.hogar_modulos FOR SELECT USING (
  hogar_id = fn_mi_hogar() OR fn_es_admin_hogar(hogar_id)
);
CREATE POLICY "modulos_write" ON public.hogar_modulos FOR ALL
  USING (fn_es_admin_hogar(hogar_id))
  WITH CHECK (fn_es_admin_hogar(hogar_id));

-- 2.5 Politicas SELECT compartidas (adicionales a las existentes) -
-- PostgreSQL combina politicas permisivas con OR: no se tocan INSERT/UPDATE existentes.

CREATE POLICY "tx_select_hogar" ON public.transacciones FOR SELECT USING (
  auth.uid() = user_id
  OR ( hogar_id IS NOT NULL
       AND hogar_id = fn_mi_hogar()
       AND fn_modulo_liberado(hogar_id, 'transacciones')
       AND privado = false )
);

CREATE POLICY "presupuestos_select_hogar" ON public.presupuestos FOR SELECT USING (
  auth.uid() = user_id
  OR ( hogar_id IS NOT NULL
       AND hogar_id = fn_mi_hogar()
       AND fn_modulo_liberado(hogar_id, 'presupuestos') )
);

CREATE POLICY "tarjetas_select_hogar" ON public.tarjetas_credito FOR SELECT USING (
  auth.uid() = user_id
  OR ( hogar_id IS NOT NULL
       AND hogar_id = fn_mi_hogar()
       AND fn_modulo_liberado(hogar_id, 'tarjetas') )
);

CREATE POLICY "prestamos_select_hogar" ON public.prestamos FOR SELECT USING (
  auth.uid() = user_id
  OR ( hogar_id IS NOT NULL
       AND hogar_id = fn_mi_hogar()
       AND fn_modulo_liberado(hogar_id, 'prestamos') )
);

CREATE POLICY "cuentas_ahorro_select_hogar" ON public.cuentas_ahorro FOR SELECT USING (
  auth.uid() = user_id
  OR ( hogar_id IS NOT NULL
       AND hogar_id = fn_mi_hogar()
       AND fn_modulo_liberado(hogar_id, 'ahorros') )
);

CREATE POLICY "recurrentes_select_hogar" ON public.gastos_recurrentes FOR SELECT USING (
  auth.uid() = user_id
  OR ( hogar_id IS NOT NULL
       AND hogar_id = fn_mi_hogar()
       AND fn_modulo_liberado(hogar_id, 'recurrentes') )
);

CREATE POLICY "cuotas_select_hogar" ON public.compras_cuotas FOR SELECT USING (
  auth.uid() = user_id
  OR ( hogar_id IS NOT NULL
       AND hogar_id = fn_mi_hogar()
       AND fn_modulo_liberado(hogar_id, 'cuotas') )
);

-- 2.6 Vista de perfiles del hogar ----------------------------------
CREATE OR REPLACE VIEW public.v_hogar_perfiles
WITH (security_invoker = false) AS
  SELECT p.id, p.nombre, hm.hogar_id, hm.rol, hm.estado
  FROM public.profiles p
  JOIN public.hogar_miembros hm ON hm.user_id = p.id;

REVOKE ALL ON public.v_hogar_perfiles FROM anon;
GRANT SELECT ON public.v_hogar_perfiles TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_perfiles_mi_hogar()
RETURNS SETOF public.v_hogar_perfiles LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT * FROM public.v_hogar_perfiles WHERE hogar_id = fn_mi_hogar();
$$;

-- 2.7 RPCs del flujo de membresia ---------------------------------

-- Crear hogar: inserta hogar + membresia admin + modulos (todo cerrado)
CREATE OR REPLACE FUNCTION public.fn_crear_hogar(p_nombre TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM hogar_miembros
             WHERE user_id = auth.uid() AND estado IN ('pendiente','activo'))
    THEN RAISE EXCEPTION 'YA_TIENE_HOGAR'; END IF;
  INSERT INTO hogares (nombre, admin_id) VALUES (p_nombre, auth.uid()) RETURNING id INTO v_id;
  INSERT INTO hogar_miembros (hogar_id, user_id, rol, estado)
    VALUES (v_id, auth.uid(), 'admin', 'activo');
  INSERT INTO hogar_modulos (hogar_id, modulo)
    SELECT v_id, m FROM unnest(ARRAY[
      'transacciones','presupuestos','tarjetas',
      'prestamos','ahorros','recurrentes','cuotas']) AS m;
  PERFORM fn_vincular_datos_hogar(auth.uid(), v_id);
  RETURN v_id;
END $$;

-- Unirse con codigo
CREATE OR REPLACE FUNCTION public.fn_solicitar_union(p_codigo TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_hogar UUID;
BEGIN
  SELECT id INTO v_hogar FROM hogares WHERE codigo_invitacion = upper(trim(p_codigo));
  IF v_hogar IS NULL THEN RAISE EXCEPTION 'CODIGO_INVALIDO'; END IF;
  IF EXISTS (SELECT 1 FROM hogar_miembros
             WHERE user_id = auth.uid() AND estado IN ('pendiente','activo'))
    THEN RAISE EXCEPTION 'YA_TIENE_HOGAR'; END IF;
  INSERT INTO hogar_miembros (hogar_id, user_id, rol, estado)
  VALUES (v_hogar, auth.uid(), 'miembro', 'pendiente');
  RETURN v_hogar;
END $$;

-- Aprobar (solo admin): activa la membresia y vincula datos historicos
CREATE OR REPLACE FUNCTION public.fn_aprobar_miembro(p_hogar UUID, p_user UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT fn_es_admin_hogar(p_hogar) THEN RAISE EXCEPTION 'NO_ADMIN'; END IF;
  UPDATE hogar_miembros SET estado = 'activo'
   WHERE hogar_id = p_hogar AND user_id = p_user AND estado = 'pendiente';
  IF NOT FOUND THEN RAISE EXCEPTION 'SOLICITUD_NO_ENCONTRADA'; END IF;
  PERFORM fn_vincular_datos_hogar(p_user, p_hogar);
END $$;

-- Backfill: vincula datos historicos de un usuario a un hogar
CREATE OR REPLACE FUNCTION public.fn_vincular_datos_hogar(p_user UUID, p_hogar UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE transacciones      SET hogar_id = p_hogar WHERE user_id = p_user AND hogar_id IS NULL;
  UPDATE presupuestos       SET hogar_id = p_hogar WHERE user_id = p_user AND hogar_id IS NULL;
  UPDATE tarjetas_credito   SET hogar_id = p_hogar WHERE user_id = p_user AND hogar_id IS NULL;
  UPDATE prestamos          SET hogar_id = p_hogar WHERE user_id = p_user AND hogar_id IS NULL;
  UPDATE cuentas_ahorro     SET hogar_id = p_hogar WHERE user_id = p_user AND hogar_id IS NULL;
  UPDATE gastos_recurrentes SET hogar_id = p_hogar WHERE user_id = p_user AND hogar_id IS NULL;
  UPDATE compras_cuotas     SET hogar_id = p_hogar WHERE user_id = p_user AND hogar_id IS NULL;
END $$;

-- Remover miembro: desvincula datos, estado = removido
CREATE OR REPLACE FUNCTION public.fn_remover_miembro(p_hogar UUID, p_user UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT fn_es_admin_hogar(p_hogar) AND auth.uid() <> p_user
    THEN RAISE EXCEPTION 'NO_AUTORIZADO'; END IF;
  UPDATE hogar_miembros SET estado = 'removido'
   WHERE hogar_id = p_hogar AND user_id = p_user;
  UPDATE transacciones      SET hogar_id = NULL WHERE user_id = p_user AND hogar_id = p_hogar;
  UPDATE presupuestos       SET hogar_id = NULL WHERE user_id = p_user AND hogar_id = p_hogar;
  UPDATE tarjetas_credito   SET hogar_id = NULL WHERE user_id = p_user AND hogar_id = p_hogar;
  UPDATE prestamos          SET hogar_id = NULL WHERE user_id = p_user AND hogar_id = p_hogar;
  UPDATE cuentas_ahorro     SET hogar_id = NULL WHERE user_id = p_user AND hogar_id = p_hogar;
  UPDATE gastos_recurrentes SET hogar_id = NULL WHERE user_id = p_user AND hogar_id = p_hogar;
  UPDATE compras_cuotas     SET hogar_id = NULL WHERE user_id = p_user AND hogar_id = p_hogar;
END $$;

-- Liberar / cerrar modulo (solo admin)
CREATE OR REPLACE FUNCTION public.fn_liberar_modulo(p_hogar UUID, p_modulo TEXT, p_habilitado BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT fn_es_admin_hogar(p_hogar) THEN RAISE EXCEPTION 'NO_ADMIN'; END IF;
  INSERT INTO hogar_modulos (hogar_id, modulo, habilitado)
  VALUES (p_hogar, p_modulo, p_habilitado)
  ON CONFLICT (hogar_id, modulo) DO UPDATE
    SET habilitado = EXCLUDED.habilitado, actualizado_en = now();
END $$;

-- 2.8 Trigger: todo registro nuevo se vincula al hogar automaticamente
CREATE OR REPLACE FUNCTION public.trg_set_hogar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.hogar_id IS NULL THEN
    SELECT hogar_id INTO NEW.hogar_id FROM hogar_miembros
    WHERE user_id = NEW.user_id AND estado = 'activo' LIMIT 1;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER t_hogar_tx  BEFORE INSERT ON public.transacciones
  FOR EACH ROW EXECUTE FUNCTION public.trg_set_hogar();
CREATE TRIGGER t_hogar_pre BEFORE INSERT ON public.presupuestos
  FOR EACH ROW EXECUTE FUNCTION public.trg_set_hogar();
CREATE TRIGGER t_hogar_tc  BEFORE INSERT ON public.tarjetas_credito
  FOR EACH ROW EXECUTE FUNCTION public.trg_set_hogar();
CREATE TRIGGER t_hogar_pr  BEFORE INSERT ON public.prestamos
  FOR EACH ROW EXECUTE FUNCTION public.trg_set_hogar();
CREATE TRIGGER t_hogar_ca  BEFORE INSERT ON public.cuentas_ahorro
  FOR EACH ROW EXECUTE FUNCTION public.trg_set_hogar();
CREATE TRIGGER t_hogar_gr  BEFORE INSERT ON public.gastos_recurrentes
  FOR EACH ROW EXECUTE FUNCTION public.trg_set_hogar();
CREATE TRIGGER t_hogar_cc  BEFORE INSERT ON public.compras_cuotas
  FOR EACH ROW EXECUTE FUNCTION public.trg_set_hogar();
