# Arquitectura: Family Finance App
**Versión:** V10 (Ingesta automática + revisión de pendientes) · **Última actualización:** 2026-07-12 · **Rama activa:** `main` (producción) / `v2-advanced` (desarrollo)

---

## 1. Stack Tecnológico

| Capa | Tecnología | Versión | Notas |
|---|---|---|---|
| Framework | Expo | SDK 56.0.9 | File-based routing, soporte iOS/Android/Web |
| Router | Expo Router | 56.2.9 | Basado en React Navigation v7 |
| Lenguaje | TypeScript | ~6.0.3 | Modo estricto, alias `@/*` → `./src/*` |
| Estilos | React Native StyleSheet | — | Sin Tailwind/NativeWind; estilos inline tipados |
| Animaciones | React Native Animated API | — | Sin Framer Motion (web-only) |
| Gráficos | react-native-svg | 15.15.4 | Sparklines SVG en pestaña Análisis |
| Date Picker | @react-native-community/datetimepicker | 9.1.0 | Picker nativo iOS/Android; web usa `<input type="date">` |
| Iconos | @expo/vector-icons (Ionicons) | ^15.0.2 | Tab bar, íconos de UI |
| Backend & DB | Supabase (PostgreSQL 15) | ^2.107.0 | RLS en todas las tablas |
| Auth | Supabase Auth | — | Teléfono + contraseña |
| Persistencia sesión | expo-sqlite + polyfill AsyncStorage | ~56.0.4 | Configurado en `src/lib/supabase.ts` |
| Deploy web | Vercel | — | Build: `expo export --platform web`, SPA rewrite |
| OCR | Google Vision API | — | Lectura de tickets de supermercado con foto |
| Visión IA (WA) | Anthropic Claude claude-haiku-4-5-20251001 | API 2023-06-01 | Extracción estructurada de comprobantes Yape/Plin |
| Parsing IA (email) | Anthropic Claude claude-haiku-4-5-20251001 | API 2023-06-01 | Extracción de monto/moneda/comercio/tarjeta de texto bancario |
| WhatsApp | Meta Cloud API v19 | — | Receptor de capturas de pago automáticas |
| Automatización email | Make.com | — | Gmail → Edge Function pipeline (ver `AUTOMATION.md`) |
| Tipo de cambio | Google Sheets + open.er-api.com | — | Cascada con caché en `tipos_cambio` |

---

## 2. Estructura del Proyecto

```
family-finance-app/
├── app/
│   ├── _layout.tsx                  # Root layout + guardián de sesión
│   ├── onboarding.tsx               # Obligatorio si perfil_completado = false
│   ├── registrar.tsx                # Registro de transacciones (gasto único / recurrente / cuotas)
│   ├── historial.tsx                # Wrapper sobre TransactionsList
│   ├── importar.tsx                 # Import por voucher / ticket con foto (OCR)
│   ├── compromisos.tsx              # Gastos recurrentes del mes actual
│   ├── gestionar-categorias.tsx     # CRUD de categorías y subcategorías
│   ├── gestionar-deudas.tsx         # CRUD de gastos recurrentes
│   ├── categoria-detalle.tsx        # Drill-down de gastos por categoría + mes
│   ├── vinculacion-whatsapp.tsx     # Config: vincular número WA + ver pendientes por clasificar
│   ├── pendientes.tsx               # Revisión de gastos auto-capturados (confirmar/rechazar)
│   ├── ahorros.tsx                  # Operaciones sobre cuentas de ahorro
│   ├── pagos.tsx                    # Pago de deuda de tarjeta de crédito
│   ├── prestamos.tsx                # Abono de cuota de préstamo
│   ├── (auth)/
│   │   ├── _layout.tsx
│   │   ├── login.tsx
│   │   └── register.tsx
│   └── (tabs)/
│       ├── _layout.tsx              # Bottom tab bar (5 pestañas + Ionicons)
│       ├── index.tsx                # Dashboard principal (Home Evervault)
│       ├── transacciones.tsx        # Historial unificado paginado
│       ├── analisis.tsx             # Análisis: Resumen / Categorías / Precios / Deuda
│       ├── cuentas.tsx              # Ahorros, tarjetas, préstamos
│       └── mas.tsx                  # Perfil, configuración, logout
├── src/
│   ├── components/
│   │   ├── SparklineChart.tsx       # Gráfico de línea SVG (react-native-svg)
│   │   ├── DatePickerInput.tsx      # Selector de fecha cross-platform (web: <input type="date">, native: DateTimePicker)
│   │   └── TransactionsList.tsx    # Lista unificada paginada con edición inline
│   ├── hooks/
│   │   ├── useCategorias.ts             # Hook: carga v_categorias + fallback hardcoded
│   │   ├── useExchangeRate.ts           # Hook: obtiene tasa PEN/USD del día
│   │   └── useAutoApplyCommitments.ts   # Hook: llama fn_auto_apply_recurrentes al montar
│   ├── lib/
│   │   ├── supabase.ts             # Cliente Supabase con polyfill SQLite
│   │   ├── ocrImage.ts             # Captura de foto + Google Vision OCR
│   │   └── parseVoucher.ts         # Parser de texto OCR → líneas de productos
│   └── services/
│       └── exchangeRate.ts         # Servicio tipo de cambio (cascada 4 fuentes)
├── supabase/
│   ├── config.toml                  # Configuración CLI Supabase (project id, jwt config)
│   └── functions/
│       ├── whatsapp-webhook/
│       │   ├── index.ts             # Entry point: webhook Meta → validación → orquestación
│       │   ├── providers.ts         # Adaptador Meta Cloud API: parse, download, reply, HMAC
│       │   ├── parseImage.ts        # Extracción Claude claude-haiku-4-5-20251001 visión → JSON Yape/Plin
│       │   └── deno.json            # Imports map para Deno (esm.sh)
│       └── ingest-transaction/
│           ├── index.ts             # Entry point: valida token → parsea texto → inserta PENDIENTE_REVISION
│           ├── parseText.ts         # Claude Haiku → {monto, moneda, comercio, ultimos_4, tipo}
│           └── deno.json            # Imports map para Deno (esm.sh)
├── AUTOMATION.md                    # Guía Make/n8n/MacroDroid para ingesta automática
├── docs/
│   ├── architecture.md             # Este archivo
│   ├── deploy-edge-function.sh     # Script workaround deploy Edge Functions (Docker bug)
│   ├── make-blueprint-email-ingesta.json  # Blueprint Make.com importable para Gmail → ingest
│   ├── migration_deploy.sql        # Setup inicial (profiles + trigger auth)
│   ├── migration_v2.sql            # Motor de conciliación + triggers
│   ├── migration_v2_patch.sql      # Correcciones RLS
│   ├── migration_v2_patch2.sql     # Fix trigger deuda_tarjeta
│   ├── migration_v3.sql            # Tabla presupuestos + fix triggers ahorros
│   ├── migration_v3_patch.sql      # Limpieza nuclear de triggers duplicados
│   ├── migration_v4.sql            # Columnas multi-moneda + tabla tipos_cambio
│   ├── migration_v5.sql            # Módulos ahorros/préstamos + presupuesto_template
│   ├── migration_v6.sql            # seguimiento_diario + modulo_tarjetas + categorias_personalizadas
│   ├── migration_v7.sql            # transaccion_detalles (líneas de ticket) + fuente_raw
│   ├── migration_v8.sql            # telefono_whatsapp + operacion_id único + v_pendientes_clasificacion
│   ├── migration_v9.sql            # v_gastos_programados_mes V9 + fn_auto_apply_recurrentes + dia_cierre
│   └── migration_v10.sql           # ultimos_4 en tarjetas + estado en transacciones + ingest_tokens + log_errores_ingesta
├── hooks/
│   └── useNotifications.ts         # Push notifications (Expo Notifications)
├── vercel.json                      # Build + SPA rewrite config
├── app.json                         # Config Expo
├── package.json
└── tsconfig.json                    # Paths alias @/* → src/*
```

---

## 3. Navegación (Expo Router)

### Bottom Tab Bar — 5 pestañas

| Tab | Archivo | Ícono (Ionicons) | Descripción |
|---|---|---|---|
| Inicio | `(tabs)/index.tsx` | `home` | Dashboard: balance, presupuestos, FAB Anotar |
| Movimientos | `(tabs)/transacciones.tsx` | `swap-horizontal` | Historial paginado con edición inline + banner de pendientes |
| Análisis | `(tabs)/analisis.tsx` | `bar-chart` | Resumen / Categorías / Precios / Deuda |
| Cuentas | `(tabs)/cuentas.tsx` | `wallet` | Ahorros, tarjetas, préstamos |
| Config | `(tabs)/mas.tsx` | `settings` | Perfil, moneda base, módulos, logout |

### Pantallas Stack (fuera de tabs)

| Ruta | Descripción | Parámetros |
|---|---|---|
| `/registrar` | Gasto único / recurrente / en cuotas / ingreso | `?tipo=gasto\|ingreso` |
| `/importar` | Importar voucher o ticket (OCR con foto) | `?modo=voucher\|ticket` |
| `/compromisos` | Gastos recurrentes y en cuotas del mes | — |
| `/historial` | Historial completo (wrapper TransactionsList) | — |
| `/categoria-detalle` | Transacciones de una categoría en un mes | `categoria`, `presupuesto`, `moneda` |
| `/gestionar-categorias` | CRUD de categorías y subcategorías | — |
| `/gestionar-deudas` | CRUD de gastos recurrentes | — |
| `/ahorros` | Abono / retiro / interés en cuentas de ahorro | — |
| `/pagos` | Pago de deuda de tarjeta | — |
| `/prestamos` | Abono de cuota de préstamo | — |
| `/pendientes` | Revisión de gastos auto-capturados: confirmar (categorizar) o rechazar | — |
| `/onboarding` | Completar perfil (nombre, apellido) | — |

---

## 4. Esquema de Base de Datos

### 4.1 Tablas del Usuario

#### `profiles`
Creada automáticamente por trigger al registrar en `auth.users`.

| Columna | Tipo | Notas |
|---|---|---|
| id | UUID PK | = auth.users.id |
| nombre | TEXT | |
| apellido | TEXT | |
| telefono | TEXT | |
| moneda_base | VARCHAR(3) | Default `'PEN'` |
| ingreso_mensual | NUMERIC | V5 |
| presupuesto_template | JSONB | Default `{}` — V5 |
| modulo_ahorros | BOOLEAN | Default `false` — V5 |
| modulo_prestamos | BOOLEAN | Default `false` — V5 |
| modulo_tarjetas | BOOLEAN | Default `true` — V6 |
| perfil_completado | BOOLEAN | Controla redirección a onboarding |
| creado_en | TIMESTAMPTZ | |

#### `transacciones`
**Fuente única de verdad.** Todo movimiento financiero genera una fila aquí.

| Columna | Tipo | Notas |
|---|---|---|
| id | UUID PK | |
| user_id | UUID | FK auth.users |
| tipo | TEXT | `'ingreso'` / `'gasto'` |
| monto | NUMERIC(12,2) | En la moneda de la tx |
| categoria | TEXT | e.g. `'Alimentación'`, `'Pago Tarjeta'` |
| subcategoria_id | UUID | FK subcategorias (nullable) |
| descripcion | TEXT | |
| metodo_pago | TEXT | `'efectivo'` / `'tarjeta'` / `'transferencia'` |
| tarjeta_id | UUID | FK tarjetas_credito (nullable) |
| prestamo_id | UUID | FK prestamos (nullable) |
| cuenta_ahorro_id | UUID | FK cuentas_ahorro (nullable) |
| gastos_recurrentes_id | UUID | FK gastos_recurrentes (nullable) |
| fuente | TEXT | `'manual'` / `'pago_tarjeta'` / `'abono_prestamo'` / `'ahorro_abono'` / `'ahorro_retiro'` / `'auto_email'` / `'auto_notification'` / `'auto_whatsapp'` |
| estado | TEXT | `'MANUAL'` (default) / `'PENDIENTE_REVISION'` / `'PROCESADO'` — V10 |
| moneda | VARCHAR(3) | Default `'PEN'` — V4 |
| tipo_cambio | NUMERIC(8,4) | Tasa al momento del INSERT — V4 |
| fecha | DATE | Fecha efectiva (puede diferir de creado_en) |
| es_gasto_unico | BOOLEAN | Marca si fue registrado como gasto único directo |
| fuente_raw | TEXT | Texto original del OCR / voucher — V7 |
| activo | BOOLEAN | `false` = anulada (dispara reversión por trigger) |
| creado_en | TIMESTAMPTZ | |

#### `transaccion_detalles` (V7)
Líneas de un ticket de supermercado o voucher importado.

| Columna | Tipo | Notas |
|---|---|---|
| id | UUID PK | |
| transaccion_id | UUID | FK transacciones ON DELETE CASCADE |
| producto | TEXT | Nombre del producto |
| cantidad | NUMERIC | Default 1 |
| precio_unitario | NUMERIC | |
| precio_total | NUMERIC | cantidad × precio_unitario |
| created_at | TIMESTAMPTZ | |

#### `tarjetas_credito`

| Columna | Tipo | Notas |
|---|---|---|
| id | UUID PK | |
| user_id | UUID | FK auth.users |
| nombre_banco | TEXT | BCP, BBVA, Scotiabank, etc. |
| ultimos_4 | VARCHAR(4) | |
| limite_credito | NUMERIC(12,2) | |
| deuda_actual | NUMERIC(12,2) | Mantenida por triggers |
| fecha_corte | INTEGER | Día del mes |
| fecha_pago | INTEGER | Día del mes |
| dia_cierre | INTEGER | Día de cierre del ciclo de facturación — V9 |
| ultimos_4 | VARCHAR(4) | Últimos 4 dígitos; usado por ingest-transaction para matching — V10 |
| moneda | VARCHAR(3) | Default `'PEN'` — V4 |
| activo | BOOLEAN | |

#### `prestamos`

| Columna | Tipo | Notas |
|---|---|---|
| id | UUID PK | |
| user_id | UUID | FK auth.users |
| nombre_entidad | TEXT | |
| monto_original | NUMERIC(12,2) | |
| saldo_pendiente | NUMERIC(12,2) | Mantenido por triggers |
| cuotas_totales | INTEGER | |
| cuotas_pagadas | INTEGER | Incrementado por trigger |
| monto_cuota | NUMERIC(12,2) | |
| tasa_interes | NUMERIC(6,4) | |
| fecha_inicio | DATE | |

#### `cuentas_ahorro`

| Columna | Tipo | Notas |
|---|---|---|
| id | UUID PK | |
| user_id | UUID | FK auth.users |
| nombre_cuenta | TEXT | |
| banco | TEXT | |
| saldo_actual | NUMERIC(12,2) | Mantenido por triggers |
| saldo_meta | NUMERIC(12,2) | Opcional |
| moneda | VARCHAR(3) | Default `'PEN'` — V4 |
| activo | BOOLEAN | |

#### `ahorros_inversiones`
Movimientos de cuentas de ahorro. El frontend siempre hace INSERT; nunca UPDATE directo.

| Columna | Tipo | Notas |
|---|---|---|
| id | UUID PK | |
| user_id | UUID | FK auth.users |
| cuenta_ahorro_id | UUID | FK cuentas_ahorro |
| subtipo | TEXT | `'abono'` / `'retiro'` / `'interes'` |
| monto | NUMERIC(12,2) | Ya en moneda de la cuenta (pre-convertido) |
| descripcion | TEXT | |
| moneda_original | VARCHAR(3) | Moneda que ingresó el usuario — V4 |
| tipo_cambio | NUMERIC(8,4) | Tasa usada para conversión — V4 |
| creado_en | TIMESTAMPTZ | |

#### `presupuestos` (V3)

| Columna | Tipo | Notas |
|---|---|---|
| id | UUID PK | |
| user_id | UUID | FK auth.users |
| categoria | TEXT | |
| monto_limite | NUMERIC(12,2) | |
| periodo | DATE | Primer día del mes: `'2026-06-01'` |
| seguimiento_diario | BOOLEAN | Default `false` — V6 |
| UNIQUE | — | `(user_id, categoria, periodo)` |

#### `gastos_recurrentes`
Suscripciones y gastos fijos mensuales.

| Columna | Tipo | Notas |
|---|---|---|
| id | UUID PK | |
| user_id | UUID | FK auth.users |
| monto | NUMERIC(12,2) | |
| categoria | TEXT | |
| descripcion | TEXT | |
| dia_cobro | INTEGER | Día del mes en que se cobra |
| mes_inicio | DATE | Primer día del mes de inicio |
| mes_fin | DATE | Nullable — si se anula, se pone mes anterior |
| aplicado | BOOLEAN | Si ya se generó tx en el mes actual |
| creado_en | TIMESTAMPTZ | |

#### `compras_cuotas`
Compras diferidas (meses sin intereses).

| Columna | Tipo | Notas |
|---|---|---|
| id | UUID PK | |
| user_id | UUID | FK auth.users |
| descripcion | TEXT | |
| categoria | TEXT | |
| monto_total | NUMERIC(12,2) | |
| monto_cuota | NUMERIC(12,2) | monto_total / total_cuotas |
| total_cuotas | INTEGER | |
| cuotas_pagadas | INTEGER | Default 0 |
| dia_cobro | INTEGER | |
| mes_inicio | DATE | |
| metodo_pago | TEXT | `'efectivo'` / `'tarjeta'` |
| tarjeta_id | UUID | FK tarjetas_credito (nullable) |
| activo | BOOLEAN | Default true |

#### `categorias_personalizadas` (V6)

| Columna | Tipo | Notas |
|---|---|---|
| id | UUID PK | |
| user_id | UUID | FK auth.users |
| nombre | TEXT | |
| icono | TEXT | Emoji |
| es_personalizada | BOOLEAN | Default true |
| created_at | TIMESTAMPTZ | |

#### `subcategorias`
Subcategorías por usuario, vinculadas a una categoría por nombre.

| Columna | Tipo | Notas |
|---|---|---|
| id | UUID PK | |
| user_id | UUID | FK auth.users |
| categoria_nombre | TEXT | Nombre de la categoría padre |
| nombre | TEXT | |
| creado_en | TIMESTAMPTZ | |

#### `ingest_tokens` (V10)
Tokens de autenticación por dispositivo/servicio para el pipeline de ingesta automática.

| Columna | Tipo | Notas |
|---|---|---|
| token | TEXT PK | Bearer token enviado en el header `Authorization` |
| user_id | UUID | FK auth.users — a qué cuenta pertenece el token |
| descripcion | TEXT | Ej: "Make.com Gmail", "MacroDroid BCP" |
| activo | BOOLEAN | Revocar sin afectar otros tokens |
| creado_en | TIMESTAMPTZ | |
| ultimo_uso | TIMESTAMPTZ | Actualizado por la Edge Function en cada uso |

#### `log_errores_ingesta` (V10)
Log de textos que no pudieron parsearse o insertarse. Sin RLS — solo service_role accede.

| Columna | Tipo | Notas |
|---|---|---|
| id | UUID PK | |
| token | TEXT | Token que envió la petición (trazabilidad) |
| source | TEXT | `'email'` / `'notification'` |
| raw_text | TEXT | Texto original recibido |
| error_tipo | TEXT | `'PARSE_FAILED'` / `'NO_MONTO'` / `'INSERT_FAILED'` / `'AUTH_FAILED'` |
| error_msg | TEXT | |
| parsed_partial | JSONB | Resultado parcial de la IA si lo hubo |
| creado_en | TIMESTAMPTZ | |

### 4.2 Tablas Auxiliares

#### `tipos_cambio` (V4)
Caché diario de tasa PEN/USD.

| Columna | Tipo | Notas |
|---|---|---|
| id | UUID PK | |
| fecha | DATE UNIQUE | |
| compra | NUMERIC(8,4) | |
| venta | NUMERIC(8,4) | |
| fuente | TEXT | `'google_sheet'` / `'er-api'` / `'fallback'` |
| creado_en | TIMESTAMPTZ | |

#### `pagos_tarjeta`
Disparador de pago de deuda. El trigger escribe en `transacciones`.

| Columna | Tipo | Notas |
|---|---|---|
| id | UUID PK | |
| user_id | UUID | FK auth.users |
| tarjeta_id | UUID | FK tarjetas_credito |
| monto | NUMERIC(12,2) | |
| descripcion | TEXT | |
| creado_en | TIMESTAMPTZ | |

#### `prestamos_abonos`
Disparador de abono de cuota. El trigger escribe en `transacciones`.

| Columna | Tipo | Notas |
|---|---|---|
| id | UUID PK | |
| user_id | UUID | FK auth.users |
| prestamo_id | UUID | FK prestamos |
| monto | NUMERIC(12,2) | |
| descripcion | TEXT | |
| creado_en | TIMESTAMPTZ | |

### 4.3 Vistas

#### `v_categorias`
Unión de categorías base del sistema + `categorias_personalizadas` del usuario, con `sort_order` para orden consistente. Usada por `useCategorias` hook.

#### `v_gastos_programados_mes` (V9)
Vista de gastos recurrentes y cuotas pendientes para el mes actual (`security_invoker = true`). Usada por Dashboard y Compromisos.
- `aplicado` es un campo dinámico calculado con `EXISTS` sobre `transacciones` (no una columna estática), lo que elimina la necesidad de UPDATE manual y garantiza coherencia
- Para recurrentes: busca si ya existe una tx vinculada via `gastos_recurrentes_id` en el mes actual
- Para cuotas: compara `cuota_actual` con el número de cuota esperado este mes

#### `v_pendientes_clasificacion` (V8, actualizada V10)
Vista de transacciones del usuario autenticado que requieren acción: `categoria = 'Por clasificar'` (WhatsApp sin categorizar) **o** `estado = 'PENDIENTE_REVISION'` (gastos auto-capturados por email/notificación). Usada para badges de pendientes.

### 4.4 Funciones RPC

#### `fn_deuda_capas(p_mes DATE)`
Calcula el termómetro de deuda 3 capas por categoría:
- `deuda_real`: gastos ya registrados en `transacciones` hasta el día de hoy
- `deuda_presupuestada`: límite de `presupuestos` para el mes
- `deuda_proyectada`: proyección al cierre del mes (real + pendientes de `v_gastos_programados_mes`)

Retorna: `SETOF { categoria, deuda_real, deuda_presupuestada, deuda_proyectada }`

#### `fn_auto_apply_recurrentes(p_user_id UUID)` (V9)
Crea transacciones en `transacciones` para todos los gastos recurrentes activos cuyo `dia_cobro` ya pasó en el mes actual y que no tienen tx vinculada. Idempotente. `SECURITY DEFINER`. Retorna `INTEGER` (número de filas insertadas).
- Llamada desde `useAutoApplyCommitments` hook al montar las pantallas Inicio y Compromisos
- La fecha de la transacción se clampea al último día del mes si `dia_cobro` excede los días del mes

---

## 5. Motor de Conciliación (Triggers)

> **Principio:** El frontend solo hace INSERT. Toda lógica de saldos vive en triggers PostgreSQL (`SECURITY DEFINER`, `SET LOCAL row_security = off`).

```
pagos_tarjeta (INSERT)
  ├─ trg_reduce_deuda_on_pago        → tarjetas_credito.deuda_actual -= monto
  └─ trg_tx_from_pago_tarjeta        → transacciones (tipo='gasto', fuente='pago_tarjeta')

prestamos_abonos (INSERT)
  ├─ trg_reduce_saldo_on_abono       → prestamos.saldo_pendiente -= monto; cuotas_pagadas++
  └─ trg_tx_from_abono_prestamo      → transacciones (tipo='gasto', fuente='abono_prestamo')

ahorros_inversiones (INSERT)
  ├─ trg_update_saldo_ahorro         → cuentas_ahorro.saldo_actual ± monto (según subtipo)
  └─ trg_tx_from_ahorro              → transacciones (abono→'gasto' / retiro→'ingreso'; interés no genera tx)

transacciones (UPDATE activo: true → false)
  └─ trg_reverse_on_deactivate       → revierte efecto original:
       'Pago Tarjeta'    → tarjetas.deuda_actual += monto
       'Abono Préstamo'  → prestamos.saldo_pendiente += monto; cuotas_pagadas--
       'Ahorro'          → cuentas_ahorro.saldo_actual -= monto
       'Retiro Ahorro'   → cuentas_ahorro.saldo_actual += monto
       gasto con tarjeta → tarjetas.deuda_actual -= monto
```

---

## 6. Motor Multi-Moneda (V4)

### Principio
`monto` se almacena en la moneda nativa del producto. La conversión ocurre en el frontend **antes** del INSERT.

```
Usuario ingresa: 100 USD
Cuenta en:       PEN
───────────────────────────────
getTodayRate()   → { compra: 3.68, venta: 3.72 }
montoFinal       = 100 × 3.72 = 372.00 PEN
INSERT: { monto: 372.00, moneda: 'USD', tipo_cambio: 3.72 }
```

### Cascada de fuentes (`src/services/exchangeRate.ts`)

1. Supabase `tipos_cambio` (caché diaria)
2. Google Sheet del usuario (regex sobre HTML/CSV)
3. open.er-api.com (`rates.PEN` ± spread 0.02)
4. Fallback hardcoded `{ compra: 3.68, venta: 3.72 }`

### Consolidación en dashboard

```typescript
const toPEN = (tx) =>
  tx.moneda === 'PEN' ? tx.monto : tx.monto * (tx.tipo_cambio ?? rate.venta);
```

Usa `tipo_cambio` histórico del INSERT, no la tasa actual.

---

## 7. Componentes Reutilizables

### `SparklineChart` (`src/components/SparklineChart.tsx`)
Gráfico SVG de línea usando `react-native-svg`.
- Props: `values[]`, `color`, `width`, `height`, `filled`, `strokeWidth`, `showDot`
- Normaliza automáticamente los valores al espacio disponible
- Área de relleno semi-transparente + dot en el último valor
- Usado en: `analisis.tsx` (hero card, bento stats, productos)

### `TransactionsList` (`src/components/TransactionsList.tsx`)
Lista unificada de transacciones con funcionalidades completas.
- Paginación de 30 registros con infinite scroll
- Filtros: tipo (gasto/ingreso), mostrar inactivos
- Edición inline: monto, categoría, descripción, fecha
- Anulación con confirmación (dispara trigger de reversión)
- Agrupación por día con headers de fecha
- Usado en: `historial.tsx`, `transacciones.tsx`

### `DatePickerInput` (`src/components/DatePickerInput.tsx`)
Selector de fecha cross-platform.
- Props: `value: string` (ISO YYYY-MM-DD), `onChange: (iso: string) => void`, `inputStyle?`, `placeholder?`
- Web: renderiza `<input type="date">` HTML con estilos del design token de la app
- Native: botón que muestra DD/MM/YYYY; tap abre `@react-native-community/datetimepicker` con `display="spinner"` y `locale="es-PE"`
- El `require()` para el paquete nativo está dentro del componente nativo (condicional) para que el bundle web no lo incluya
- Usado en: `cuentas.tsx` (ciclo Desde/Hasta), `TransactionsList.tsx` (edición inline), `pagos.tsx`, `prestamos.tsx`, `importar.tsx`

### `useAutoApplyCommitments` (`src/hooks/useAutoApplyCommitments.ts`)
Hook que llama `fn_auto_apply_recurrentes` al montar la pantalla.
- Obtiene el `user.id` de la sesión activa y llama `supabase.rpc('fn_auto_apply_recurrentes', { p_user_id })`
- Idempotente: si los recurrentes ya están aplicados, la RPC retorna 0 sin insertar nada
- Usado en: `app/(tabs)/index.tsx` (Dashboard), `app/compromisos.tsx`

### `useCategorias` (`src/hooks/useCategorias.ts`)
Hook que carga categorías de gasto del usuario.
- Consulta `v_categorias` en Supabase
- Merge con `BASE_EXPENSE_CATS` como fallback (evita pantalla vacía si la vista no existe)
- Exporta: `categorias[]`, `loading`, `BASE_INCOME_CATS`, `ICON_MAP`, `iconForCat()`

### `useExchangeRate` (`src/hooks/useExchangeRate.ts`)
Hook que obtiene la tasa PEN/USD del día.
- Llama `getTodayRate()` una sola vez al montar
- Retorna: `{ rate: { compra, venta }, loading }`

---

## 8. Row Level Security (RLS)

| Tabla | Política |
|---|---|
| profiles | ALL WHERE `auth.uid() = id` |
| transacciones | SELECT + INSERT + UPDATE WHERE `auth.uid() = user_id` |
| transaccion_detalles | SELECT + INSERT + DELETE (via JOIN a transacciones) |
| tarjetas_credito | ALL WHERE `auth.uid() = user_id` |
| prestamos | ALL WHERE `auth.uid() = user_id` |
| cuentas_ahorro | ALL WHERE `auth.uid() = user_id` |
| ahorros_inversiones | ALL WHERE `auth.uid() = user_id` |
| presupuestos | ALL WHERE `auth.uid() = user_id` |
| gastos_recurrentes | ALL WHERE `auth.uid() = user_id` |
| compras_cuotas | ALL WHERE `auth.uid() = user_id` |
| categorias_personalizadas | ALL WHERE `auth.uid() = user_id` |
| subcategorias | ALL WHERE `auth.uid() = user_id` |
| tipos_cambio | SELECT + INSERT + UPDATE WHERE `auth.role() = 'authenticated'` (compartida) |
| pagos_tarjeta | ALL WHERE `auth.uid() = user_id` |
| prestamos_abonos | ALL WHERE `auth.uid() = user_id` |
| ingest_tokens | ALL WHERE `auth.uid() = user_id` |
| log_errores_ingesta | Sin políticas — solo service_role (Edge Function) |

**Nota crítica:** Los triggers usan `SECURITY DEFINER` porque `auth.uid()` devuelve NULL en contexto server-side.

---

## 9. Historial de Migraciones

| Archivo | Contenido | Orden |
|---|---|---|
| `migration_deploy.sql` | Setup inicial: tabla `profiles` + trigger `on_auth_user_created` | 0 |
| `migration_v2.sql` | Motor de conciliación: triggers, columnas `fuente`/`prestamo_id`/`cuenta_ahorro_id`, reversión | 1 |
| `migration_v2_patch.sql` | Correcciones adicionales de RLS | 2 |
| `migration_v2_patch2.sql` | Fix trigger `trg_deuda_tarjeta` | 3 |
| `migration_v3.sql` | Tabla `presupuestos` + política UPDATE en `cuentas_ahorro` | 4 |
| `migration_v3_patch.sql` | Limpieza nuclear: DROP de triggers duplicados en `ahorros_inversiones` | 4b |
| `migration_v4.sql` | Columnas `moneda`/`tipo_cambio` + tabla `tipos_cambio` | 5 |
| `migration_v5.sql` | `ingreso_mensual`, `presupuesto_template`, `modulo_ahorros`, `modulo_prestamos` en profiles | 6 |
| `migration_v6.sql` | `seguimiento_diario` en presupuestos + `modulo_tarjetas` + tabla `categorias_personalizadas` | 7 |
| `migration_v7.sql` | Tabla `transaccion_detalles` + columna `fuente_raw` en transacciones | 8 |
| `migration_v8.sql` | `telefono_whatsapp` en profiles + `operacion_id` único en transacciones + vista `v_pendientes_clasificacion` | 9 |
| `migration_v9.sql` | `v_gastos_programados_mes` V9 con `aplicado` dinámico (EXISTS) + `fn_auto_apply_recurrentes` RPC + `dia_cierre` en `tarjetas_credito` | 10 |
| `migration_v10.sql` | `ultimos_4` en `tarjetas_credito` + columna `estado` en `transacciones` + tablas `ingest_tokens` y `log_errores_ingesta` + actualización `v_pendientes_clasificacion` | 11 |

---

## 10. Variables de Entorno

```bash
EXPO_PUBLIC_SUPABASE_URL=https://<proyecto>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
EXPO_PUBLIC_GOOGLE_SHEET_URL=<url-hoja-tipo-cambio>  # opcional
```

Definidas en `.env.local` (no commiteado). Cargadas automáticamente por el script de inicio.

---

## 11. Pipeline de Ingesta Automática (V10)

Permite capturar gastos desde correos bancarios o notificaciones push sin intervención manual.

```
Gmail / Notificación Android
        │
        │  texto crudo (raw_text)
        ▼
  Make.com / n8n / MacroDroid
        │
        │  POST /functions/v1/ingest-transaction
        │  Authorization: Bearer <ingest_token>
        │  { "source": "email"|"notification", "raw_text": "..." }
        ▼
  Edge Function: ingest-transaction (Deno)
        │
        ├─ Valida token → ingest_tokens → user_id
        ├─ Claude Haiku parseText() → { monto, moneda, comercio, ultimos_4, tipo }
        ├─ Busca tarjeta por (user_id, ultimos_4) → tarjeta_id (nullable)
        ├─ INSERT transacciones { estado='PENDIENTE_REVISION', categoria='Por clasificar', fuente='auto_email' }
        └─ Si falla → INSERT log_errores_ingesta; siempre retorna HTTP 200
                │
                ▼
         app/pendientes.tsx
                │
        Usuario revisa gasto:
        ├─ ✓ Confirmar → selecciona categoría → UPDATE estado='PROCESADO'
        └─ ✕ Rechazar → UPDATE activo=false
```

### Autenticación del pipeline
- Tokens en tabla `ingest_tokens` (uno por dispositivo/servicio)
- El token mapea a un `user_id`; RLS aísla los datos por usuario
- Revocar un token (`activo=false`) no afecta a otros servicios del mismo usuario

### Edge Function: `ingest-transaction`
- **Runtime:** Deno (Supabase Edge Functions)
- **Deploy:** workaround EZBR+brotli documentado en `docs/deploy-edge-function.sh` (bug del Docker bundler v1.74.2)
- **Siempre retorna HTTP 200** para evitar retries de Make/n8n ante errores de parsing
- **Campos en `transacciones` insertados:** `monto`, `moneda`, `descripcion` (comercio), `tarjeta_id`, `fuente`, `fuente_raw`, `estado='PENDIENTE_REVISION'`, `categoria='Por clasificar'`, `tipo='gasto'`, `metodo_pago='tarjeta'`

### Make.com (Gmail → Edge Function)
- Blueprint importable en `docs/make-blueprint-email-ingesta.json`
- Módulo Gmail filtra por `Sender email address` (ej: `notificaciones@notificacionesbcp.com.pe`)
- `Content format: Full content` para obtener el cuerpo completo del email
- `raw_text` mapeado con `{{X.snippet}}` + `{{X.text}}` del módulo Gmail

---

## 12. Decisiones de Diseño Clave

| Decisión | Razón |
|---|---|
| Single source of truth en `transacciones` | Historial unificado sin lógica dispersa en el frontend |
| Pre-conversión de moneda en frontend | Los triggers existentes no necesitan modificarse; trazabilidad en columnas separadas |
| Tasa histórica vs. tasa del día | `tx.tipo_cambio` guardado en el INSERT preserva la precisión histórica |
| Triggers SECURITY DEFINER | `auth.uid()` devuelve NULL en contexto de trigger server-side |
| `useFocusEffect` para refetch | Recarga datos al volver al tab sin estado global ni Context API |
| `_cancelledIds` Set module-level | Evita que gastos recurrentes anulados reaparezcan si la vista los sigue devolviendo |
| `SparklineChart` SVG puro | Sparklines de línea reales sin librerías de charts pesadas; compatible web/iOS/Android |
| Merge `v_categorias` + `BASE_EXPENSE_CATS` | Si la vista DB no existe, la app no rompe; las categorías base siempre están disponibles |

| `estado` en transacciones (no columna de destino separada) | Evita duplicar datos; el flujo de revisión usa la misma tabla con filtros por `estado` |
| Edge Function siempre retorna 200 | Evita retries automáticos de Make/n8n que duplicarían el gasto |
| Token por dispositivo/servicio | Revocación granular sin afectar otros pipelines del usuario |
| `pendientes.tsx` fuera de tabs | Pantalla de revisión es temporal/modal; no merece tab permanente |

---

## 13. Ejecución Local

```bash
npm install
npx expo start               # LAN
npx expo start --tunnel      # Acceso externo (Expo Go)
npx expo export --platform web  # Build web para Vercel
vercel --prod                # Deploy a producción
```
