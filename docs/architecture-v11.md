# Arquitectura Objetivo: Family Finance App
**Versión:** V11 (Hardening de seguridad + ingesta inteligente + app nativa) · **Fecha:** 2026-07-12
**Estado:** Propuesta de implementación — reemplaza a `architecture.md` V10 al completarse las fases 0–3

---

## 0. Resumen ejecutivo

V10 resolvió la **captura** automática de gastos (email/WhatsApp → Edge Function → PENDIENTE_REVISION).
V11 resuelve tres cosas:

1. **Seguridad de producción** — cierra los 7 hallazgos identificados en la auditoría (OCR en cliente, tabla `tipos_cambio` envenenable, tokens en texto plano, sin rate limiting, sin retención de logs, sin dedup de email, sin validación del output de IA).
2. **Clasificación automática** — el usuario deja de categorizar manualmente: reglas determinísticas + categoría sugerida por Claude con umbral de confianza (paridad con Clever/goclever.app).
3. **App nativa instalable** — build con EAS para Android/iOS, sesión en almacenamiento seguro, bloqueo biométrico y notificaciones push reales.

Orden de ejecución recomendado: **Fase 0 → 1 → 2 → 3 → 4 → (5 opcional)**.
La Fase 0 es prerequisito de todo: sin entornos separados ni migraciones versionadas, cada cambio posterior es riesgoso.

---

## 1. Fase 0 — Higiene del repositorio y entornos (1–2 días)

**Objetivo:** dejar de aplicar SQL a mano sobre una única base de producción.

### Paso 0.1 — Crear proyecto de staging en Supabase
1. En el dashboard de Supabase, crear un segundo proyecto: `family-finance-staging`.
2. Mantener el actual como `family-finance-prod`.

### Paso 0.2 — Migraciones versionadas con Supabase CLI
```bash
# En la raíz del repo
supabase init                       # si no existe supabase/migrations
supabase link --project-ref <ref-staging>

# Consolidar el esquema actual como baseline (V10 = punto de partida)
supabase db pull                    # genera supabase/migrations/<timestamp>_remote_schema.sql

# A partir de ahora, cada cambio:
supabase migration new v11_seguridad
# (editar el .sql generado)
supabase db push                    # aplica a staging
```
3. Mover los `docs/migration_v*.sql` a `docs/legacy/` — quedan como historia, ya no se aplican a mano.
4. **Regla:** ningún SQL entra a prod sin haber corrido antes en staging.

### Paso 0.3 — Variables por entorno
```
.env.local            → staging (desarrollo diario)
.env.production       → prod (solo lo usa el build de producción)
```
En Vercel: configurar `EXPO_PUBLIC_SUPABASE_URL` / `ANON_KEY` de **prod** como Environment Variables del proyecto (no hardcodear).

### Paso 0.4 — CI con GitHub Actions
Crear `.github/workflows/ci.yml`:
```yaml
name: CI
on: [pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npx tsc --noEmit          # typecheck estricto
      - run: npx expo export --platform web  # el build web no debe romperse
```
Y `.github/workflows/deploy-functions.yml` (dispara en push a `main`):
```yaml
      - uses: supabase/setup-cli@v1
      - run: supabase functions deploy whatsapp-webhook ingest-transaction ocr-ticket
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_PROJECT_ID: ${{ secrets.SUPABASE_PROJECT_ID }}
```
Esto además elimina el workaround manual de `docs/deploy-edge-function.sh`.

### Paso 0.5 — Ramas
- `main` → producción (protegida, merge solo por PR)
- `v2-advanced` → renombrar a `develop`; los PR van contra `develop`, y `develop → main` es el release.

**Criterio de salida de la fase:** puedes crear una tabla nueva en staging con `supabase migration new` + `db push` sin tocar prod, y el CI corre en cada PR.

---

## 2. Fase 1 — Seguridad crítica (3–5 días)

### Paso 1.1 — Mover Google Vision OCR al servidor 🔴 CRÍTICO
**Problema:** `src/lib/ocrImage.ts` llama a Vision desde el cliente → la API key viaja en el bundle web público de Vercel (toda variable `EXPO_PUBLIC_*` es extraíble).

1. Crear Edge Function `supabase/functions/ocr-ticket/index.ts`:
```typescript
import { createClient } from "@supabase/supabase-js";

Deno.serve(async (req) => {
  // 1. Autenticar con el JWT del usuario (no con token de ingesta)
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { image_base64 } = await req.json();
  if (!image_base64 || image_base64.length > 8_000_000) {
    return new Response("Bad request", { status: 400 });
  }

  // 2. Llamar a Vision con la key que SOLO vive en secrets del servidor
  const visionRes = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${Deno.env.get("GOOGLE_VISION_KEY")}`,
    {
      method: "POST",
      body: JSON.stringify({
        requests: [{ image: { content: image_base64 }, features: [{ type: "TEXT_DETECTION" }] }],
      }),
    }
  );
  const json = await visionRes.json();
  return Response.json({ text: json.responses?.[0]?.fullTextAnnotation?.text ?? "" });
});
```
2. Registrar el secret: `supabase secrets set GOOGLE_VISION_KEY=<key>`.
3. En `src/lib/ocrImage.ts`, reemplazar la llamada directa a Vision por `supabase.functions.invoke('ocr-ticket', { body: { image_base64 } })`.
4. **Rotar la key actual de Google Vision** (ya estuvo expuesta en el bundle) y restringir la nueva por API en Google Cloud Console.
5. Eliminar cualquier `EXPO_PUBLIC_GOOGLE_VISION*` del proyecto y de Vercel.

### Paso 1.2 — Blindar `tipos_cambio` 🔴 CRÍTICO
**Problema:** RLS actual permite INSERT/UPDATE a cualquier usuario autenticado en una tabla compartida → un usuario puede escribir una tasa falsa y corromper las conversiones de todos.

Migración `v11_seguridad` (parte 1):
```sql
-- Solo lectura para usuarios; escritura únicamente vía service_role
DROP POLICY IF EXISTS "tipos_cambio_write" ON tipos_cambio;   -- ajustar al nombre real
CREATE POLICY "tc_select" ON tipos_cambio FOR SELECT TO authenticated USING (true);
-- (sin políticas de INSERT/UPDATE ⇒ solo service_role puede escribir)
```
Y mover la actualización de tasa a un cron del lado servidor:
```sql
SELECT cron.schedule('actualizar-tc', '0 9 * * *',
  $$ SELECT net.http_post(
       url := 'https://<proyecto>.supabase.co/functions/v1/actualizar-tipo-cambio',
       headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_key'))
     ) $$);
```
La Edge Function `actualizar-tipo-cambio` replica la cascada actual (Google Sheet → er-api → fallback) pero corre con service_role. El frontend deja de escribir en la tabla: `src/services/exchangeRate.ts` queda solo con SELECT + fallback local.

### Paso 1.3 — Hashear los tokens de ingesta 🟠 ALTO
**Problema:** `ingest_tokens.token` guarda el bearer en texto plano.

```sql
ALTER TABLE ingest_tokens ADD COLUMN token_hash TEXT;
ALTER TABLE ingest_tokens ADD COLUMN expira_en TIMESTAMPTZ;      -- NULL = sin expiración

-- Migrar los existentes (una sola vez; requiere pgcrypto)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
UPDATE ingest_tokens SET token_hash = encode(digest(token, 'sha256'), 'hex');
ALTER TABLE ingest_tokens ALTER COLUMN token_hash SET NOT NULL;
ALTER TABLE ingest_tokens ADD CONSTRAINT ingest_tokens_hash_uk UNIQUE (token_hash);
ALTER TABLE ingest_tokens DROP COLUMN token;                     -- adiós texto plano
ALTER TABLE ingest_tokens ADD COLUMN id UUID PRIMARY KEY DEFAULT gen_random_uuid();
```
En `ingest-transaction/index.ts`:
```typescript
const raw = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
const tokenHash = [...new Uint8Array(hashBuf)].map(b => b.toString(16).padStart(2, "0")).join("");
const { data: tok } = await admin.from("ingest_tokens")
  .select("user_id, activo, expira_en").eq("token_hash", tokenHash).single();
if (!tok?.activo || (tok.expira_en && new Date(tok.expira_en) < new Date())) {
  return new Response("Unauthorized", { status: 401 });   // ver paso 1.6
}
```
Generación (pantalla de vinculación): crear el token con `crypto.randomUUID() + crypto.randomUUID()` (256 bits), **mostrarlo una sola vez**, guardar solo el hash.

### Paso 1.4 — Rate limiting en Edge Functions 🟠 ALTO
Tabla ligera + verificación al inicio de `ingest-transaction` y `whatsapp-webhook`:
```sql
CREATE TABLE rate_limits (
  clave TEXT PRIMARY KEY,          -- ej: 'ingest:<token_hash>' o 'wa:<telefono>'
  ventana_inicio TIMESTAMPTZ NOT NULL DEFAULT now(),
  contador INT NOT NULL DEFAULT 1
);
-- Sin políticas RLS: solo service_role

CREATE OR REPLACE FUNCTION fn_check_rate_limit(p_clave TEXT, p_max INT, p_ventana INTERVAL)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE ok BOOLEAN;
BEGIN
  INSERT INTO rate_limits (clave) VALUES (p_clave)
  ON CONFLICT (clave) DO UPDATE SET
    contador = CASE WHEN rate_limits.ventana_inicio < now() - p_ventana THEN 1
                    ELSE rate_limits.contador + 1 END,
    ventana_inicio = CASE WHEN rate_limits.ventana_inicio < now() - p_ventana THEN now()
                          ELSE rate_limits.ventana_inicio END;
  SELECT contador <= p_max INTO ok FROM rate_limits WHERE clave = p_clave;
  RETURN ok;
END $$;
```
Límites sugeridos: 30 req/hora por token de ingesta, 60 req/hora por teléfono de WhatsApp. Si se excede → responder 429 **sin** llamar a Claude (protege el presupuesto de API).

### Paso 1.5 — Deduplicación del pipeline de email 🟡 MEDIO
```sql
ALTER TABLE transacciones ADD COLUMN ingest_hash TEXT;
CREATE UNIQUE INDEX ux_tx_ingest_hash ON transacciones (user_id, ingest_hash)
  WHERE ingest_hash IS NOT NULL;
```
En la Edge Function: `ingest_hash = sha256(user_id + raw_text_normalizado)`. Si el INSERT choca con el índice → responder 200 con `{ duplicado: true }` y no registrar error. (Equivalente al `operacion_id` que ya usa el flujo de WhatsApp.)

### Paso 1.6 — Semántica de errores del endpoint de ingesta 🟡 MEDIO
Mantener HTTP 200 para errores de **parsing** (evita retries de Make/n8n que duplicarían el gasto), pero devolver **401 para `AUTH_FAILED`** y **429 para rate limit**. Enmascarar fallos de autenticación con 200 te ciega ante fuerza bruta de tokens; Make no reintenta en 401.

### Paso 1.7 — Validar el output de Claude y acotar el input 🟡 MEDIO
En `parseText.ts` / `parseImage.ts`, tras el `JSON.parse`:
```typescript
const monto = Number(parsed.monto);
if (!Number.isFinite(monto) || monto <= 0 || monto > 500_000) throw new Error("NO_MONTO");
if (!["PEN", "USD"].includes(parsed.moneda)) parsed.moneda = "PEN";
if (parsed.ultimos_4 && !/^\d{4}$/.test(parsed.ultimos_4)) parsed.ultimos_4 = null;
parsed.comercio = String(parsed.comercio ?? "").slice(0, 120);
```
Y antes de llamar a la API: `raw_text = raw_text.slice(0, 4000)` — un correo malicioso arbitrariamente largo no debe inflar el costo ni el prompt.

### Paso 1.8 — Retención de `log_errores_ingesta` 🟡 MEDIO
Los `raw_text` de correos bancarios son datos personales (Ley 29733). Purga automática a 60 días:
```sql
SELECT cron.schedule('purga-logs-ingesta', '0 4 * * *',
  $$ DELETE FROM log_errores_ingesta WHERE creado_en < now() - INTERVAL '60 days' $$);
```

### Paso 1.9 — Endurecer autenticación y el cliente 🟡 MEDIO
1. Activar verificación OTP del teléfono en Supabase Auth (hoy cualquier número se registra sin verificar).
2. Política de contraseñas ≥ 10 caracteres (Auth → Settings).
3. Sesión móvil: reemplazar el polyfill AsyncStorage por `expo-secure-store` como storage del cliente Supabase (Keychain/Keystore en vez de texto plano):
```typescript
import * as SecureStore from "expo-secure-store";
const secureStorage = {
  getItem: (k: string) => SecureStore.getItemAsync(k),
  setItem: (k: string, v: string) => SecureStore.setItemAsync(k, v),
  removeItem: (k: string) => SecureStore.deleteItemAsync(k),
};
// createClient(..., { auth: { storage: secureStorage, ... } })  // solo en native
```
4. Headers de seguridad en `vercel.json`:
```json
{
  "headers": [{
    "source": "/(.*)",
    "headers": [
      { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains" },
      { "key": "X-Frame-Options", "value": "DENY" },
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
      { "key": "Content-Security-Policy",
        "value": "default-src 'self'; connect-src 'self' https://*.supabase.co https://open.er-api.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'" }
    ]
  }]
}
```
(Ajustar el CSP tras probar; Expo web inyecta estilos inline.)

**Criterio de salida de la fase:** ninguna API key vive en el bundle del cliente; nadie salvo service_role escribe `tipos_cambio`; los tokens en DB son hashes; el endpoint responde 401/429 correctamente y no se puede duplicar un gasto reenviando el mismo correo.

---

## 3. Fase 2 — Ingesta inteligente: adiós a la clasificación manual (1 semana)

**Objetivo:** que ≥ 90 % de los gastos capturados entren ya categorizados (paridad con la propuesta de valor de Clever), manteniendo al usuario en control.

### Paso 2.1 — Nueva tabla de reglas de categorización
```sql
CREATE TABLE reglas_categorizacion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  comercio_normalizado TEXT NOT NULL,     -- lower(trim(comercio)) sin tildes
  categoria TEXT NOT NULL,
  subcategoria_id UUID REFERENCES subcategorias(id),
  veces_aplicada INT NOT NULL DEFAULT 0,
  creado_en TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, comercio_normalizado)
);
ALTER TABLE reglas_categorizacion ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reglas_all" ON reglas_categorizacion FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

### Paso 2.2 — Columnas de clasificación en `transacciones`
```sql
ALTER TABLE transacciones
  ADD COLUMN categoria_sugerida TEXT,
  ADD COLUMN confianza_ia NUMERIC(3,2),        -- 0.00–1.00
  ADD COLUMN auto_clasificado BOOLEAN DEFAULT false;
```

### Paso 2.3 — Cadena de decisión en `ingest-transaction`
Orden (del más barato al más caro):
```
1. Regla del usuario (reglas_categorizacion por comercio_normalizado)
     → hit: INSERT estado='PROCESADO', auto_clasificado=true, veces_aplicada++
     → SIN llamada a Claude (ahorro directo de API)
2. Claude Haiku con categoría en el mismo prompt (costo marginal ~cero):
     Prompt añade: "categoria: una de [<lista de v_categorias del usuario>]"
     y "confianza: número 0-1 de qué tan seguro estás".
     → confianza ≥ 0.90: INSERT estado='PROCESADO', auto_clasificado=true
     → confianza <  0.90: INSERT estado='PENDIENTE_REVISION',
                          categoria='Por clasificar', categoria_sugerida=<x>
```
Regla de oro: **la IA solo sugiere; solo una regla explícita o una confianza muy alta auto-confirma.** El resto pasa por `pendientes.tsx` como hoy, pero con la sugerencia preseleccionada (confirmar = 1 tap).

### Paso 2.4 — Aprendizaje al confirmar
En `pendientes.tsx`, al confirmar una categoría:
```typescript
await supabase.from("reglas_categorizacion").upsert({
  user_id, comercio_normalizado: normalizar(tx.descripcion), categoria: catElegida,
}, { onConflict: "user_id,comercio_normalizado" });
```
Igual al **corregir** un `auto_clasificado` desde `TransactionsList` (edición inline ya existente). Así el sistema converge: la segunda vez que aparece "RAPPI*PE" ya no consulta a nadie.

### Paso 2.5 — UI de transparencia
- En `TransactionsList`: badge discreto ✨ en filas `auto_clasificado = true`; tap → corrige categoría (alimenta la regla).
- En `pendientes.tsx`: chip con la `categoria_sugerida` preseleccionada + botón "Confirmar todo" para lotes.
- En `gestionar-categorias.tsx`: nueva sección "Reglas aprendidas" con opción de eliminar una regla.

### Paso 2.6 — WhatsApp con texto libre (registrar efectivo)
En `whatsapp-webhook/index.ts`, rama para `type === "text"`:
```
Usuario: "25 taxi"  /  "gasté 40 en menú ayer"  /  "ingreso 500 freelance"
  → parseText (mismo prompt de email, + campo fecha relativa opcional)
  → misma cadena de decisión del paso 2.3
  → respuesta por WhatsApp: "✅ S/ 25.00 · Transporte · hoy. Responde 'no' para corregir."
```
Esto captura lo único que ni el email ni Yape ven: **el efectivo** — y convierte tu webhook en el "bot de gastos" que es el gancho principal de Clever.

### Paso 2.7 — Push de confirmación con acciones
Con `useNotifications.ts` ya existente + categorías de notificación de Expo:
```typescript
await Notifications.setNotificationCategoryAsync("pendiente", [
  { identifier: "confirmar", buttonTitle: "✓ Confirmar" },
  { identifier: "cambiar", buttonTitle: "Cambiar categoría" },
]);
```
Al insertarse un `PENDIENTE_REVISION` (webhook DB → Edge Function → Expo Push API), el usuario confirma desde la notificación sin abrir la app.

### Paso 2.8 — (Opcional) Detección de recurrentes
Job semanal (pg_cron) que busca patrones en `transacciones`: mismo `comercio_normalizado`, monto ±10 %, día del mes ±3, en ≥ 2 meses consecutivos → sugiere crear el `gasto_recurrente` con una notificación. Cero IA, solo SQL.

**Criterio de salida de la fase:** un correo del BCP de un comercio ya visto entra directo como PROCESADO con su categoría, sin tocar la app; el efectivo se registra por WhatsApp con un mensaje de texto.

---

## 4. Fase 3 — De web a app nativa instalable (3–4 días + revisión de stores)

**Objetivo:** APK/AAB en Play Store y build de iOS, sin depender de Expo Go.

### Paso 3.1 — Preparar el proyecto
```bash
npm install -g eas-cli
eas login                        # cuenta de Expo (gratis)
eas init                         # vincula el repo a un proyecto EAS
```
En `app.json` completar:
```json
{
  "expo": {
    "name": "Family Finance",
    "slug": "family-finance-app",
    "android": { "package": "pe.tudominio.familyfinance", "versionCode": 1 },
    "ios": { "bundleIdentifier": "pe.tudominio.familyfinance", "buildNumber": "1" },
    "plugins": ["expo-secure-store", "expo-local-authentication", "expo-notifications"]
  }
}
```

### Paso 3.2 — `eas.json` con perfiles
```json
{
  "build": {
    "development": { "developmentClient": true, "distribution": "internal",
                     "env": { "EXPO_PUBLIC_SUPABASE_URL": "https://<staging>.supabase.co" } },
    "preview":     { "distribution": "internal", "android": { "buildType": "apk" } },
    "production":  { "autoIncrement": true,
                     "env": { "EXPO_PUBLIC_SUPABASE_URL": "https://<prod>.supabase.co" } }
  },
  "submit": { "production": {} }
}
```

### Paso 3.3 — Primer build
```bash
eas build --profile preview --platform android    # APK instalable para probar en tu teléfono
eas build --profile production --platform android # AAB para Play Store
eas build --profile production --platform ios     # requiere Apple Developer ($99/año)
```
Play Console cuesta **$25 una sola vez**; para uso familiar puedes quedarte en *Internal testing* (hasta 100 testers por link, sin revisión completa de Google).

### Paso 3.4 — Bloqueo biométrico/PIN (estándar en apps financieras)
```bash
npx expo install expo-local-authentication
```
En `app/_layout.tsx`, al pasar la app a foreground:
```typescript
import * as LocalAuthentication from "expo-local-authentication";
const ok = await LocalAuthentication.authenticateAsync({
  promptMessage: "Desbloquea Family Finance",
});
if (!ok.success) { /* mostrar pantalla de bloqueo */ }
```
Configurable en la pestaña Config (`mas.tsx`), activado por defecto.

### Paso 3.5 — Notificaciones push reales
`useNotifications.ts` ya existe; con el build nativo (no Expo Go) los push de Expo funcionan en producción. Guardar el `expo_push_token` en `profiles` y enviarlo desde la Edge Function del paso 2.7.

### Paso 3.6 — Actualizaciones OTA
```bash
eas update:configure
eas update --branch production --message "fix categorías"
```
Cambios JS/TS llegan a los usuarios sin pasar por la tienda; solo cambios nativos (nuevos paquetes con código nativo) requieren rebuild.

**Criterio de salida de la fase:** la app instalada desde APK abre con biometría, apunta a prod, recibe push, y un `eas update` le llega sin reinstalar.

---

## 5. Fase 4 — Operación en producción (continuo)

| Área | Acción | Herramienta |
|---|---|---|
| Errores | `npx expo install @sentry/react-native` + `Sentry.init` en `_layout.tsx`; wrapper en Edge Functions | Sentry (plan free) |
| Backups | Plan Pro de Supabase + PITR activado; **probar una restauración** en staging | Supabase |
| Métricas de ingesta | Vista diaria: pendientes creados, auto-clasificados, errores en `log_errores_ingesta`; alerta si errores > 20 %/día | pg_cron + push |
| Costo de IA | Contador mensual de llamadas Claude por usuario (columna en `profiles` o tabla `uso_ia`); tope duro (p. ej. 300/mes) → al excederlo, insertar sin categoría sugerida | Edge Function |
| Regex antes que IA | Los correos del BCP/BBVA son plantillas fijas: intentar regex por banco primero, Claude como fallback → ~80 % menos llamadas | `parseText.ts` |
| Dominio | Dominio propio + `expo.dev`→Vercel con el mismo, para no depender del subdominio `*.vercel.app` | Vercel |

---

## 6. Fase 5 (opcional) — Modo "Familia" real

Toda la RLS actual es `auth.uid() = user_id`: la app es individual. Si se quiere visión de hogar:

```sql
CREATE TABLE hogares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  creado_por UUID REFERENCES auth.users(id),
  creado_en TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE hogar_miembros (
  hogar_id UUID REFERENCES hogares(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  rol TEXT NOT NULL DEFAULT 'miembro',      -- 'admin' / 'miembro'
  PRIMARY KEY (hogar_id, user_id)
);
ALTER TABLE transacciones ADD COLUMN hogar_id UUID REFERENCES hogares(id);

-- Patrón de política: leer lo propio + lo compartido del hogar
CREATE POLICY "tx_select_hogar" ON transacciones FOR SELECT USING (
  auth.uid() = user_id
  OR hogar_id IN (SELECT hogar_id FROM hogar_miembros WHERE user_id = auth.uid())
);
-- INSERT/UPDATE siguen siendo solo del autor (auth.uid() = user_id)
```
Decisiones a tomar **antes** de implementar: ¿las tarjetas/préstamos se comparten o solo las transacciones? ¿el gasto es del hogar por defecto o se marca? Migrar RLS con datos reales es doloroso — decidir esto antes de invitar al segundo usuario.

---

## 7. Diagrama del pipeline V11

```
Correo banco / Notif. Android / WhatsApp (foto Yape/Plin o TEXTO libre)
        │
        ▼
  Make.com / MacroDroid / Meta Cloud API
        │  Authorization: Bearer <token>  (DB guarda solo SHA-256)
        ▼
  Edge Function (Deno)
        ├─ fn_check_rate_limit ──✗──► 429
        ├─ token_hash → user_id ──✗──► 401
        ├─ ingest_hash duplicado ────► 200 {duplicado:true}
        ├─ ① reglas_categorizacion (comercio) ──hit──► PROCESADO (auto) ─┐
        ├─ ② regex por banco ──hit──► igual que ①                        │
        ├─ ③ Claude Haiku {monto, moneda, comercio, ultimos_4,           │
        │            categoria_sugerida, confianza} + validación         │
        │        ├─ confianza ≥ 0.90 ──► PROCESADO (auto) ───────────────┤
        │        └─ confianza <  0.90 ─► PENDIENTE_REVISION ──► push ────┤
        └─ error ─► log_errores_ingesta (purga 60 días) ── 200           │
                                                                         ▼
                                              Confirmación/corrección del usuario
                                              └─► upsert reglas_categorizacion (aprende)
```

Servicios del lado servidor (todas las keys en `supabase secrets`, nunca `EXPO_PUBLIC_*`):
`ocr-ticket` (Google Vision) · `ingest-transaction` · `whatsapp-webhook` · `actualizar-tipo-cambio` (cron)

---

## 8. Checklist de implementación

**Fase 0**
- [ ] Proyecto staging creado y `supabase link`
- [ ] `supabase db pull` como baseline; `docs/migration_v*` → `docs/legacy/`
- [ ] CI (typecheck + build web) en PRs; deploy de functions en push a main
- [ ] Rama `develop`; `main` protegida

**Fase 1 — Seguridad**
- [ ] OCR movido a Edge Function; key de Vision **rotada** y fuera del bundle
- [ ] `tipos_cambio`: solo SELECT para usuarios; cron server-side escribe
- [ ] `ingest_tokens`: solo `token_hash` (SHA-256) + `expira_en`
- [ ] Rate limiting (30/h token, 60/h teléfono) antes de llamar a Claude
- [ ] `ingest_hash` único por usuario (dedup email)
- [ ] 401 en AUTH_FAILED, 429 en rate limit, 200 en errores de parsing
- [ ] Validación del JSON de Claude (monto, moneda, ultimos_4, longitudes)
- [ ] Purga de `log_errores_ingesta` a 60 días
- [ ] OTP de teléfono activado; contraseñas ≥ 10
- [ ] `expo-secure-store` para la sesión en native
- [ ] Headers de seguridad en `vercel.json`

**Fase 2 — Ingesta inteligente**
- [ ] `reglas_categorizacion` + columnas `categoria_sugerida`/`confianza_ia`/`auto_clasificado`
- [ ] Cadena regla → regex → Claude con umbral 0.90
- [ ] Confirmación/corrección alimenta reglas (pendientes + edición inline)
- [ ] Badge ✨ y sección "Reglas aprendidas"
- [ ] WhatsApp acepta texto libre y responde confirmación
- [ ] Push con acciones al crear pendiente

**Fase 3 — App nativa**
- [ ] `eas init` + `eas.json` (dev/preview/production)
- [ ] APK preview instalado y probado
- [ ] Biometría/PIN al abrir
- [ ] Push token guardado en `profiles`
- [ ] `eas update` funcionando
- [ ] Play Console ($25) — internal testing

**Fase 4 — Operación**
- [ ] Sentry en app y functions
- [ ] Plan Pro + PITR + restauración probada
- [ ] Tope mensual de llamadas IA por usuario
- [ ] Regex por banco antes de Claude
