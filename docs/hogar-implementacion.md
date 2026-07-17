# Modo Hogar (V12): compartición total con liberación por admin
**Fecha:** 2026-07-12 · **Prerequisito:** Fases 0–1 de `architecture-v11.md` (staging + migraciones CLI)
**Complemento de:** `architecture-v11.md` §6

---

## 1. Modelo conceptual

```
┌──────────────────────── HOGAR ────────────────────────┐
│  Admin (1)                    Miembros (N)            │
│  ├─ aprueba/remueve miembros  ├─ ven lo liberado      │
│  ├─ LIBERA módulos ────────►  ├─ editan SOLO lo suyo  │
│  └─ ve todo lo liberado       └─ pueden marcar        │
│     (no edita lo ajeno)          registros 'privado'  │
└───────────────────────────────────────────────────────┘

Visibilidad de un registro para un miembro =
  es mío
  OR ( registro.hogar_id = mi hogar
       AND mi membresía está 'activo'
       AND el ADMIN liberó ese módulo        ← hogar_modulos
       AND registro.privado = false )

Edición = SOLO el autor (sin excepciones, ni para el admin)
```

Decisiones de diseño:

| Decisión | Razón |
|---|---|
| Todo registro se vincula al hogar automáticamente (trigger) | "Todo puede ser compartido": el usuario no decide registro por registro |
| La visibilidad la gatilla el **admin por módulo** | Tu requisito central: nada es visible hasta que el admin lo libera |
| `privado` por fila como excepción | Regalos/sorpresas; excluye la fila aunque el módulo esté liberado |
| El admin **no** edita datos ajenos | Visibilidad ≠ control; preserva confianza y simplifica RLS |
| Un usuario pertenece a **un** hogar (V12) | Simplifica `fn_mi_hogar()`; multi-hogar es ampliable después |
| Funciones `SECURITY DEFINER` para membresía | Evita la recursión infinita de RLS sobre `hogar_miembros` |

---

## 2. Migración SQL completa (`supabase migration new v12_hogar`)

```sql
-- ============================================================
-- V12: MODO HOGAR
-- ============================================================

-- 2.1 Tablas base -------------------------------------------------
CREATE TABLE hogares (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre            TEXT NOT NULL CHECK (length(nombre) BETWEEN 1 AND 60),
  admin_id          UUID NOT NULL REFERENCES auth.users(id),
  codigo_invitacion TEXT NOT NULL UNIQUE
                    DEFAULT upper(substr(md5(random()::text), 1, 8)),
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE hogar_miembros (
  hogar_id  UUID NOT NULL REFERENCES hogares(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rol       TEXT NOT NULL DEFAULT 'miembro' CHECK (rol IN ('admin','miembro')),
  estado    TEXT NOT NULL DEFAULT 'pendiente'
            CHECK (estado IN ('pendiente','activo','removido')),
  unido_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (hogar_id, user_id)
);
-- Un usuario solo puede estar activo/pendiente en UN hogar (V12)
CREATE UNIQUE INDEX ux_miembro_un_hogar ON hogar_miembros (user_id)
  WHERE estado IN ('pendiente','activo');

CREATE TABLE hogar_modulos (
  hogar_id       UUID NOT NULL REFERENCES hogares(id) ON DELETE CASCADE,
  modulo         TEXT NOT NULL CHECK (modulo IN
    ('transacciones','presupuestos','tarjetas','prestamos',
     'ahorros','recurrentes','cuotas')),
  habilitado     BOOLEAN NOT NULL DEFAULT false,   -- nace CERRADO: el admin libera
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (hogar_id, modulo)
);

-- 2.2 Columnas en tablas compartibles ----------------------------
ALTER TABLE transacciones      ADD COLUMN hogar_id UUID REFERENCES hogares(id),
                               ADD COLUMN privado BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE presupuestos       ADD COLUMN hogar_id UUID REFERENCES hogares(id);
ALTER TABLE tarjetas_credito   ADD COLUMN hogar_id UUID REFERENCES hogares(id);
ALTER TABLE prestamos          ADD COLUMN hogar_id UUID REFERENCES hogares(id);
ALTER TABLE cuentas_ahorro     ADD COLUMN hogar_id UUID REFERENCES hogares(id);
ALTER TABLE gastos_recurrentes ADD COLUMN hogar_id UUID REFERENCES hogares(id);
ALTER TABLE compras_cuotas     ADD COLUMN hogar_id UUID REFERENCES hogares(id);

CREATE INDEX ix_tx_hogar ON transacciones (hogar_id) WHERE hogar_id IS NOT NULL;

-- 2.3 Funciones helper (SECURITY DEFINER = sin recursión RLS) ----
CREATE OR REPLACE FUNCTION fn_mi_hogar()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT hogar_id FROM hogar_miembros
  WHERE user_id = auth.uid() AND estado = 'activo' LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION fn_es_admin_hogar(p_hogar UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM hogares WHERE id = p_hogar AND admin_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION fn_modulo_liberado(p_hogar UUID, p_modulo TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT habilitado FROM hogar_modulos
     WHERE hogar_id = p_hogar AND modulo = p_modulo), false);
$$;

-- 2.4 RLS de las tablas nuevas ------------------------------------
ALTER TABLE hogares        ENABLE ROW LEVEL SECURITY;
ALTER TABLE hogar_miembros ENABLE ROW LEVEL SECURITY;
ALTER TABLE hogar_modulos  ENABLE ROW LEVEL SECURITY;

-- hogares: lo ven sus miembros (cualquier estado, para ver su solicitud);
-- lo edita solo el admin
CREATE POLICY "hogares_select" ON hogares FOR SELECT USING (
  admin_id = auth.uid()
  OR id IN (SELECT hogar_id FROM hogar_miembros WHERE user_id = auth.uid())
);
CREATE POLICY "hogares_insert" ON hogares FOR INSERT
  WITH CHECK (admin_id = auth.uid());
CREATE POLICY "hogares_update" ON hogares FOR UPDATE
  USING (admin_id = auth.uid());

-- hogar_miembros: cada quien ve su fila; el admin ve y gestiona todas las de su hogar
CREATE POLICY "hm_select" ON hogar_miembros FOR SELECT USING (
  user_id = auth.uid() OR fn_es_admin_hogar(hogar_id)
);
CREATE POLICY "hm_update_admin" ON hogar_miembros FOR UPDATE
  USING (fn_es_admin_hogar(hogar_id));          -- aprobar / remover
CREATE POLICY "hm_delete_self" ON hogar_miembros FOR DELETE
  USING (user_id = auth.uid());                  -- salir del hogar
-- INSERT solo vía RPC (abajo): nadie se auto-inserta como 'activo'

-- hogar_modulos: miembros activos leen; SOLO el admin escribe (= "liberar")
CREATE POLICY "modulos_select" ON hogar_modulos FOR SELECT USING (
  hogar_id = fn_mi_hogar() OR fn_es_admin_hogar(hogar_id)
);
CREATE POLICY "modulos_write" ON hogar_modulos FOR ALL
  USING (fn_es_admin_hogar(hogar_id)) WITH CHECK (fn_es_admin_hogar(hogar_id));

-- 2.5 Nueva política de LECTURA compartida (patrón, aplicar por tabla)
CREATE POLICY "tx_select_hogar" ON transacciones FOR SELECT USING (
  auth.uid() = user_id
  OR ( hogar_id IS NOT NULL
       AND hogar_id = fn_mi_hogar()
       AND fn_modulo_liberado(hogar_id, 'transacciones')
       AND privado = false )
);
-- Repetir con su módulo correspondiente en: presupuestos, tarjetas_credito,
-- prestamos, cuentas_ahorro, gastos_recurrentes, compras_cuotas.
-- ⚠️ NO tocar las políticas de INSERT/UPDATE existentes (auth.uid() = user_id):
--    la edición sigue siendo exclusiva del autor.

-- 2.6 Nombres visibles entre miembros (profiles hoy es solo-dueño)
CREATE OR REPLACE VIEW v_hogar_perfiles
WITH (security_invoker = false) AS       -- definer: expone SOLO estas columnas
  SELECT p.id, p.nombre, p.apellido, hm.hogar_id, hm.rol, hm.estado
  FROM profiles p
  JOIN hogar_miembros hm ON hm.user_id = p.id;
-- El aislamiento lo da el WHERE del cliente + GRANT:
REVOKE ALL ON v_hogar_perfiles FROM anon;
GRANT SELECT ON v_hogar_perfiles TO authenticated;
-- Envolver en función si se quiere filtrado estricto server-side:
CREATE OR REPLACE FUNCTION fn_perfiles_mi_hogar()
RETURNS SETOF v_hogar_perfiles LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT * FROM v_hogar_perfiles WHERE hogar_id = fn_mi_hogar();
$$;

-- 2.7 RPCs del flujo de membresía ---------------------------------
-- Unirse con código (el solicitante no puede ver hogares aún ⇒ DEFINER)
CREATE OR REPLACE FUNCTION fn_solicitar_union(p_codigo TEXT)
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

-- Aprobar (solo admin): activa la membresía Y vincula datos históricos
CREATE OR REPLACE FUNCTION fn_aprobar_miembro(p_hogar UUID, p_user UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT fn_es_admin_hogar(p_hogar) THEN RAISE EXCEPTION 'NO_ADMIN'; END IF;
  UPDATE hogar_miembros SET estado = 'activo'
   WHERE hogar_id = p_hogar AND user_id = p_user AND estado = 'pendiente';
  IF NOT FOUND THEN RAISE EXCEPTION 'SOLICITUD_NO_ENCONTRADA'; END IF;
  PERFORM fn_vincular_datos_hogar(p_user, p_hogar);   -- backfill "todo compartible"
END $$;

-- Backfill / desvinculación
CREATE OR REPLACE FUNCTION fn_vincular_datos_hogar(p_user UUID, p_hogar UUID)
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

CREATE OR REPLACE FUNCTION fn_remover_miembro(p_hogar UUID, p_user UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT fn_es_admin_hogar(p_hogar) AND auth.uid() <> p_user
    THEN RAISE EXCEPTION 'NO_AUTORIZADO'; END IF;
  UPDATE hogar_miembros SET estado = 'removido'
   WHERE hogar_id = p_hogar AND user_id = p_user;
  -- Desvincular: sus datos vuelven a ser 100 % privados
  UPDATE transacciones      SET hogar_id = NULL WHERE user_id = p_user AND hogar_id = p_hogar;
  UPDATE presupuestos       SET hogar_id = NULL WHERE user_id = p_user AND hogar_id = p_hogar;
  UPDATE tarjetas_credito   SET hogar_id = NULL WHERE user_id = p_user AND hogar_id = p_hogar;
  UPDATE prestamos          SET hogar_id = NULL WHERE user_id = p_user AND hogar_id = p_hogar;
  UPDATE cuentas_ahorro     SET hogar_id = NULL WHERE user_id = p_user AND hogar_id = p_hogar;
  UPDATE gastos_recurrentes SET hogar_id = NULL WHERE user_id = p_user AND hogar_id = p_hogar;
  UPDATE compras_cuotas     SET hogar_id = NULL WHERE user_id = p_user AND hogar_id = p_hogar;
END $$;

-- Crear hogar: inserta hogar + membresía admin + módulos (todo cerrado)
CREATE OR REPLACE FUNCTION fn_crear_hogar(p_nombre TEXT)
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
    SELECT v_id, m FROM unnest(ARRAY['transacciones','presupuestos','tarjetas',
      'prestamos','ahorros','recurrentes','cuotas']) AS m;   -- habilitado=false
  PERFORM fn_vincular_datos_hogar(auth.uid(), v_id);
  RETURN v_id;
END $$;

-- 2.8 Trigger: todo registro nuevo se vincula al hogar automáticamente
CREATE OR REPLACE FUNCTION trg_set_hogar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.hogar_id IS NULL THEN
    SELECT hogar_id INTO NEW.hogar_id FROM hogar_miembros
    WHERE user_id = NEW.user_id AND estado = 'activo' LIMIT 1;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER t_hogar_tx  BEFORE INSERT ON transacciones      FOR EACH ROW EXECUTE FUNCTION trg_set_hogar();
CREATE TRIGGER t_hogar_pre BEFORE INSERT ON presupuestos       FOR EACH ROW EXECUTE FUNCTION trg_set_hogar();
CREATE TRIGGER t_hogar_tc  BEFORE INSERT ON tarjetas_credito   FOR EACH ROW EXECUTE FUNCTION trg_set_hogar();
CREATE TRIGGER t_hogar_pr  BEFORE INSERT ON prestamos          FOR EACH ROW EXECUTE FUNCTION trg_set_hogar();
CREATE TRIGGER t_hogar_ca  BEFORE INSERT ON cuentas_ahorro     FOR EACH ROW EXECUTE FUNCTION trg_set_hogar();
CREATE TRIGGER t_hogar_gr  BEFORE INSERT ON gastos_recurrentes FOR EACH ROW EXECUTE FUNCTION trg_set_hogar();
CREATE TRIGGER t_hogar_cc  BEFORE INSERT ON compras_cuotas     FOR EACH ROW EXECUTE FUNCTION trg_set_hogar();
```

**Notas importantes:**
- El pipeline de ingesta (`ingest-transaction`, WhatsApp) no cambia: inserta con `user_id` y el trigger vincula el `hogar_id` solo. Los `PENDIENTE_REVISION` también quedan visibles para el hogar si el módulo está liberado — si prefieres que los pendientes sean privados hasta confirmarse, añade `AND estado <> 'PENDIENTE_REVISION'` a la política `tx_select_hogar`.
- `v_pendientes_clasificacion` y `v_gastos_programados_mes` usan `security_invoker`, así que heredan las nuevas políticas sin cambios.
- Las vistas de análisis del dashboard deben decidir agregación: "mi vista" filtra `user_id = auth.uid()`; "vista hogar" no filtra (la RLS ya limita a lo liberado).

---

## 3. Cambios de frontend

| Archivo | Cambio |
|---|---|
| `app/hogar.tsx` (nuevo) | Crear hogar / unirse con código / lista de miembros con aprobar-remover (admin) / **switches de módulos "Liberar para el hogar"** (admin) / código de invitación copiable |
| `app/(tabs)/mas.tsx` | Entrada "Mi Hogar" con badge de solicitudes pendientes (admin) |
| `app/(tabs)/index.tsx` | Selector segmentado `Mi vista / Hogar` (persistido); en vista hogar, totales agregados y desglose por miembro |
| `src/components/TransactionsList.tsx` | En vista hogar: mostrar nombre del autor (via `fn_perfiles_mi_hogar()`); edición inline deshabilitada en filas ajenas |
| `app/registrar.tsx` | Toggle discreto "🔒 Privado (no visible para el hogar)" → `privado = true` |
| `src/hooks/useHogar.ts` (nuevo) | Estado: hogar, rol, miembros, módulos liberados; expone `esAdmin`, `liberarModulo()`, `aprobar()`, `remover()` |

Flujo del usuario:
```
Admin:   Config → Mi Hogar → "Crear hogar" → comparte el código A1B2C3D4
Miembro: Config → Mi Hogar → "Unirse" → ingresa código → "Esperando aprobación"
Admin:   recibe badge → Aprobar → elige qué liberar: [x] Transacciones [ ] Tarjetas ...
Ambos:   Dashboard → selector "Hogar" → ven lo liberado, editan solo lo suyo
```

---

## 4. Implementación con Claude Code — paso a paso

### 4.1 Requisitos e instalación
- Cuenta con plan **Pro, Max, Team o Enterprise** (o facturación por API desde console.anthropic.com). El plan gratuito de Claude.ai no incluye Claude Code.
- Instalador nativo (recomendado, no requiere Node.js):
```bash
# macOS / Linux / WSL
curl -fsSL https://claude.ai/install.sh | bash
# Windows PowerShell
irm https://claude.ai/install.ps1 | iex
```
- Verificar y arrancar:
```bash
claude --version
cd family-finance-app
claude            # primer arranque: login vía navegador
```
Docs oficiales: https://code.claude.com/docs/en/setup

### 4.2 Crear el `CLAUDE.md` del repo (hazlo ANTES del primer prompt)
Ejecuta `/init` dentro de Claude Code para que genere un borrador, y reemplázalo/complétalo con esto:

```markdown
# Family Finance App

## Stack
- Expo SDK 56 + Expo Router (file-based, carpeta app/), TypeScript estricto, alias @/* → ./src/*
- Estilos: React Native StyleSheet inline tipado. NO usar Tailwind/NativeWind.
- Backend: Supabase (Postgres 15, RLS en todas las tablas), Edge Functions en Deno (supabase/functions/)
- La lógica de saldos vive en triggers de Postgres. El frontend SOLO hace INSERT
  en pagos_tarjeta / prestamos_abonos / ahorros_inversiones; nunca UPDATE de saldos.

## Flujo de base de datos (OBLIGATORIO)
- Cambios de esquema SOLO vía `supabase migration new <nombre>` + editar el SQL generado.
- NUNCA aplicar SQL directo a producción. Target por defecto: proyecto staging.
- Políticas RLS de escritura existentes (auth.uid() = user_id) NO se modifican.
- hogar_miembros: usar SIEMPRE las funciones fn_mi_hogar()/fn_es_admin_hogar()
  en políticas (evita recursión RLS). No escribir subqueries directas a hogar_miembros
  dentro de sus propias políticas.

## Convenciones
- Textos de UI en español (es-PE). Moneda base PEN, formateo S/ 1,234.56.
- Componentes reutilizables en src/components/, hooks en src/hooks/.
- Refetch con useFocusEffect, sin estado global ni Context API.
- DatePickerInput para toda fecha (cross-platform web/native).

## Comandos
- npx tsc --noEmit        # typecheck (debe pasar antes de cada commit)
- npx expo start          # dev
- npx expo export --platform web   # build web (no debe romperse)

## Documentos de referencia
- docs/architecture.md            # arquitectura V10 vigente
- docs/architecture-v11.md        # plan de seguridad e ingesta
- docs/hogar-implementacion.md    # este feature (Modo Hogar V12)
```

Copia también `architecture-v11.md` y `hogar-implementacion.md` a `docs/` del repo: Claude Code los leerá como fuente de verdad.

### 4.3 Método de trabajo
1. **Modo plan primero:** presiona `Shift+Tab` hasta ver *plan mode*. Claude Code propone el plan sin tocar archivos; revísalo y aprueba.
2. **Un prompt = una subtarea = un commit.** Pídele el commit al terminar cada una (rollback fácil con git).
3. **`/clear` entre prompts grandes** para empezar con contexto limpio (re-lee CLAUDE.md).
4. Si edita algo que no pediste: `git diff` para ver, `git checkout -- <archivo>` para revertir.

### 4.4 Secuencia de prompts (pegar en orden)

**Prompt 1 — Migración**
> Lee docs/hogar-implementacion.md sección 2. Crea la migración `v12_hogar` con `supabase migration new v12_hogar` y copia el SQL de esa sección adaptándolo a los nombres reales de las políticas existentes del repo (revisa docs/legacy/migration_v*.sql para los nombres). Aplica las políticas SELECT compartidas del patrón 2.5 a las 7 tablas listadas, cada una con su módulo. No modifiques ninguna política de INSERT/UPDATE existente. Aplícala a staging con `supabase db push` y verifica con `supabase db lint`. Criterio de aceptación: la migración corre limpia en staging y `SELECT fn_mi_hogar()` no da error de recursión.

**Prompt 2 — Hook y servicios**
> Crea src/hooks/useHogar.ts según docs/hogar-implementacion.md sección 3: carga hogar del usuario (via hogar_miembros + hogares), rol, miembros (fn_perfiles_mi_hogar), módulos (hogar_modulos), y expone esAdmin, crearHogar(nombre), solicitarUnion(codigo), aprobar(userId), remover(userId), liberarModulo(modulo, habilitado). Todas las mutaciones vía supabase.rpc() a las funciones fn_* de la migración. Maneja los errores CODIGO_INVALIDO y YA_TIENE_HOGAR con mensajes en español. Criterio: typecheck limpio.

**Prompt 3 — Pantalla Hogar**
> Crea app/hogar.tsx usando useHogar, siguiendo el estilo visual de app/gestionar-categorias.tsx: (a) sin hogar → dos cards "Crear hogar" y "Unirse con código"; (b) miembro pendiente → estado "Esperando aprobación"; (c) miembro activo → lista de miembros con nombre y rol; (d) admin además: código de invitación copiable, botón Aprobar en pendientes, Remover con confirmación, y sección "Módulos compartidos" con un Switch por módulo que llama liberarModulo. Agrega la entrada "Mi Hogar" en app/(tabs)/mas.tsx con badge del número de solicitudes pendientes si soy admin.

**Prompt 4 — Vista Hogar en dashboard y movimientos**
> En app/(tabs)/index.tsx agrega un selector segmentado "Mi vista | Hogar" (visible solo si hay hogar activo; persiste en AsyncStorage). En "Mi vista" todas las queries filtran user_id = mi uid (comportamiento actual). En "Hogar" quitan ese filtro (la RLS limita a lo liberado) y el resumen agrega una fila de desglose por miembro usando fn_perfiles_mi_hogar. En src/components/TransactionsList.tsx: prop `vistaHogar`; cuando está activa, muestra el nombre del autor en cada fila y deshabilita la edición inline y la anulación en filas cuyo user_id ≠ mi uid.

**Prompt 5 — Registro privado**
> En app/registrar.tsx agrega un toggle "🔒 Privado (no visible para el hogar)" visible solo si el usuario tiene hogar activo, que setea privado=true en el INSERT. En TransactionsList muestra un ícono de candado en mis propias filas privadas (solo yo las veo, así que el ícono solo aparece en mi vista).

**Prompt 6 — Verificación end-to-end en staging**
> Escribe docs/qa-hogar.md con el guion de prueba manual con dos usuarios de staging (A admin, B miembro): 1) A crea hogar y NO libera nada → B no ve nada de A; 2) A libera 'transacciones' → B ve las transacciones de A pero no sus tarjetas; 3) B no puede editar transacciones de A (verificar que el UPDATE falla por RLS, no solo por UI); 4) A marca una transacción privada → B no la ve; 5) A remueve a B → B deja de ver todo y sus datos quedan hogar_id NULL; 6) B intenta unirse con código inválido → error controlado. Ejecuta contra staging lo que puedas verificar por SQL (por ejemplo el punto 3 con dos JWT) y reporta resultados.

### 4.5 Después de implementar
```bash
git checkout -b feature/modo-hogar     # antes del Prompt 1, en realidad
# ... prompts 1-6, un commit por prompt ...
gh pr create --base develop --title "Modo Hogar V12"
# merge a develop → probar en staging con la familia → develop a main → supabase db push a prod
```

---

## 5. Checklist V12

- [ ] Migración `v12_hogar` aplicada en staging sin errores
- [ ] `fn_mi_hogar()` / `fn_es_admin_hogar()` sin recursión RLS
- [ ] Políticas SELECT compartidas en las 7 tablas; INSERT/UPDATE intactas
- [ ] Trigger `trg_set_hogar` vincula inserciones nuevas (incluye pipeline de ingesta)
- [ ] `fn_crear_hogar` / `fn_solicitar_union` / `fn_aprobar_miembro` (con backfill) / `fn_remover_miembro` (con desvinculación)
- [ ] Pantalla `hogar.tsx`: crear/unirse/aprobar/remover/liberar módulos
- [ ] Selector Mi vista/Hogar + autor visible + edición bloqueada en filas ajenas
- [ ] Toggle privado por transacción
- [ ] QA de 6 escenarios con dos usuarios en staging aprobado
- [ ] Decidido: ¿pendientes de revisión visibles para el hogar? (default: sí)
