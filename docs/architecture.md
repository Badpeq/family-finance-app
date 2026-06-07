# Arquitectura: Family Finance App
**Versión actual:** V4 (multi-moneda) · **Última actualización:** 2026-06-07

---

## 1. Stack Tecnológico

| Capa | Tecnología | Notas |
|---|---|---|
| Framework | Expo SDK 56 + Expo Router | File-based routing, soporte iOS/Android/Web |
| Lenguaje | TypeScript (modo estricto) | Alias `@/*` → `./src/*` |
| Estilos | React Native `StyleSheet` | Sin NativeWind; estilos tipados inline |
| Backend & DB | Supabase (PostgreSQL) | RLS habilitado en todas las tablas |
| Auth | Supabase Auth | Teléfono + contraseña; sin OAuth |
| Persistencia sesión | `expo-sqlite/localStorage` + polyfill | Instalado en `src/lib/supabase.ts` |
| Exposición externa | `@expo/ngrok` | Tunnel para acceso fuera de red local |

---

## 2. Estructura del Proyecto

```
family-finance-app/
├── app/
│   ├── _layout.tsx              # Root layout + guardián de sesión
│   ├── onboarding.tsx           # Obligatorio si perfil_completado = false
│   ├── registrar.tsx            # Registro de transacciones manuales
│   ├── ahorros.tsx              # Abonar/retirar en cuentas de ahorro
│   ├── pagos.tsx                # Pagos de tarjeta de crédito
│   ├── prestamos.tsx            # Abonos a préstamos
│   ├── historial.tsx            # Vista de historial (legacy, reemplazada por tab)
│   ├── (auth)/
│   │   ├── _layout.tsx
│   │   ├── login.tsx
│   │   └── register.tsx
│   └── (tabs)/
│       ├── _layout.tsx          # Bottom tab bar (4 pestañas)
│       ├── index.tsx            # Dashboard principal
│       ├── transacciones.tsx    # Historial unificado paginado
│       ├── cuentas.tsx          # Gestión de productos financieros
│       └── mas.tsx              # Perfil, configuración, logout
├── src/
│   ├── lib/
│   │   └── supabase.ts          # Cliente Supabase con polyfill SQLite
│   ├── hooks/
│   │   └── useExchangeRate.ts   # Hook: obtiene tasa PEN/USD del día
│   └── services/
│       └── exchangeRate.ts      # Servicio de tipo de cambio (cascada)
└── docs/
    ├── architecture.md          # Este archivo
    ├── migration_v2.sql         # Motor de conciliación + triggers
    ├── migration_v2_patch.sql   # Correcciones RLS
    ├── migration_v2_patch2.sql  # Fix trigger deuda_tarjeta
    ├── migration_v3.sql         # Tabla presupuestos + fix triggers ahorros
    ├── migration_v3_patch.sql   # Limpieza nuclear de triggers duplicados
    └── migration_v4.sql         # Columnas multi-moneda + tabla tipos_cambio
```

---

## 3. Navegación (Expo Router)

### Bottom Tab Bar — 4 pestañas

| Tab | Archivo | Ícono | Descripción |
|---|---|---|---|
| Inicio | `(tabs)/index.tsx` | 🏠 | Dashboard: balance, sparklines, presupuestos, FAB |
| Movimientos | `(tabs)/transacciones.tsx` | 📊 | Historial completo paginado (30/página) |
| Cuentas | `(tabs)/cuentas.tsx` | 💼 | Ahorros, tarjetas, préstamos + modales de creación |
| Más | `(tabs)/mas.tsx` | ⚙️ | Perfil, moneda base, ayuda, logout |

### Stack adicional (fuera de tabs)

- `registrar.tsx` — entrada de transacciones (gasto/ingreso/transferencia)
- `ahorros.tsx` — operaciones sobre cuentas de ahorro (abono/retiro/interés)
- `pagos.tsx` — pago de deuda de tarjeta
- `prestamos.tsx` — abono de cuota de préstamo

---

## 4. Esquema de Base de Datos (Supabase)

### 4.1 Tablas principales

#### `profiles`
Creada automáticamente por trigger al registrar usuario en `auth.users`.

| Columna | Tipo | Notas |
|---|---|---|
| id | UUID | = auth.users.id |
| nombre | TEXT | |
| apellido | TEXT | |
| telefono | TEXT | |
| moneda_base | VARCHAR(3) | Default 'PEN' |
| perfil_completado | BOOLEAN | Controla onboarding |
| creado_en | TIMESTAMPTZ | |

#### `tarjetas_credito`

| Columna | Tipo | Notas |
|---|---|---|
| id | UUID | PK |
| user_id | UUID | FK auth.users |
| nombre_banco | TEXT | BCP, BBVA, Scotiabank, etc. |
| ultimos_4 | VARCHAR(4) | |
| limite_credito | NUMERIC(12,2) | |
| deuda_actual | NUMERIC(12,2) | Mantenida por triggers |
| fecha_corte | INTEGER | Día del mes |
| fecha_pago | INTEGER | Día del mes |
| moneda | VARCHAR(3) | DEFAULT 'PEN' (V4) |
| activo | BOOLEAN | |

#### `prestamos`

| Columna | Tipo | Notas |
|---|---|---|
| id | UUID | PK |
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
| id | UUID | PK |
| user_id | UUID | FK auth.users |
| nombre_cuenta | TEXT | |
| banco | TEXT | |
| saldo_actual | NUMERIC(12,2) | Mantenido por triggers |
| saldo_meta | NUMERIC(12,2) | Opcional |
| moneda | VARCHAR(3) | DEFAULT 'PEN' (V4) |
| activo | BOOLEAN | |

#### `transacciones`
Tabla central. **Fuente única de verdad** para todo el historial financiero.

| Columna | Tipo | Notas |
|---|---|---|
| id | UUID | PK |
| user_id | UUID | FK auth.users |
| tipo | TEXT | 'ingreso' / 'gasto' |
| monto | NUMERIC(12,2) | En la moneda de la transacción |
| categoria | TEXT | 'Alimentación', 'Pago Tarjeta', 'Ahorro', etc. |
| descripcion | TEXT | |
| metodo_pago | TEXT | 'efectivo', 'tarjeta', 'transferencia' |
| tarjeta_id | UUID | FK tarjetas_credito (nullable) |
| prestamo_id | UUID | FK prestamos (nullable) — V2 |
| cuenta_ahorro_id | UUID | FK cuentas_ahorro (nullable) — V2 |
| fuente | TEXT | 'manual','pago_tarjeta','abono_prestamo','ahorro_abono','ahorro_retiro' |
| moneda | VARCHAR(3) | DEFAULT 'PEN' (V4) |
| tipo_cambio | NUMERIC(8,4) | DEFAULT 1.0000; tasa al momento del INSERT (V4) |
| activo | BOOLEAN | false = anulada (dispara reversión) |
| creado_en | TIMESTAMPTZ | |

#### `ahorros_inversiones`
Movimientos de cuentas de ahorro. El frontend siempre hace INSERT aquí, nunca UPDATE directo.

| Columna | Tipo | Notas |
|---|---|---|
| id | UUID | PK |
| user_id | UUID | FK auth.users |
| cuenta_ahorro_id | UUID | FK cuentas_ahorro |
| subtipo | TEXT | 'abono' / 'retiro' / 'interes' |
| monto | NUMERIC(12,2) | En la moneda nativa de la cuenta (pre-convertido en frontend) |
| descripcion | TEXT | |
| moneda_original | VARCHAR(3) | Moneda en que ingresó el usuario (V4) |
| tipo_cambio | NUMERIC(8,4) | Tasa usada para pre-conversión (V4) |
| creado_en | TIMESTAMPTZ | |

#### `presupuestos` (V3)

| Columna | Tipo | Notas |
|---|---|---|
| id | UUID | PK |
| user_id | UUID | FK auth.users |
| categoria | TEXT | |
| monto_limite | NUMERIC(12,2) | |
| periodo | DATE | Primer día del mes: '2026-06-01' |
| UNIQUE | (user_id, categoria, periodo) | |

#### `tipos_cambio` (V4)
Caché diario de tasas PEN/USD. UNIQUE por fecha.

| Columna | Tipo | Notas |
|---|---|---|
| id | UUID | PK |
| fecha | DATE | UNIQUE |
| compra | NUMERIC(8,4) | |
| venta | NUMERIC(8,4) | |
| fuente | TEXT | 'google_sheet' / 'er-api' / 'fallback' |
| creado_en | TIMESTAMPTZ | |

#### Tablas de flujo (escriben transacciones vía triggers)

- **`pagos_tarjeta`** — pago manual de deuda; trigger inserta en `transacciones` como gasto
- **`prestamos_abonos`** — abono de cuota; trigger inserta en `transacciones` como gasto

---

## 5. Motor de Conciliación (Triggers)

### Principio fundamental
> **El frontend solo hace un INSERT.** Toda la lógica de actualización de saldos y generación del historial vive en triggers PostgreSQL (`SECURITY DEFINER`, `SET LOCAL row_security = off`).

### Mapa de triggers activos

```
pagos_tarjeta (INSERT)
  ├─ trg_reduce_deuda_on_pago     → tarjetas_credito.deuda_actual -= monto
  └─ trg_tx_from_pago_tarjeta     → transacciones (tipo='gasto', fuente='pago_tarjeta')

prestamos_abonos (INSERT)
  ├─ trg_reduce_saldo_on_abono    → prestamos.saldo_pendiente -= monto; cuotas_pagadas++
  └─ trg_tx_from_abono_prestamo   → transacciones (tipo='gasto', fuente='abono_prestamo')

ahorros_inversiones (INSERT)
  ├─ trg_update_saldo_ahorro      → cuentas_ahorro.saldo_actual ± monto (según subtipo)
  └─ trg_tx_from_ahorro           → transacciones (abono→'gasto'/retiro→'ingreso'; interes no genera TX)

transacciones (UPDATE activo: true→false)
  └─ trg_reverse_on_deactivate    → revierte el efecto original según categoría/fuente:
       'Pago Tarjeta'   → tarjetas_credito.deuda_actual += monto
       'Abono Préstamo' → prestamos.saldo_pendiente += monto; cuotas_pagadas--
       'Ahorro'         → cuentas_ahorro.saldo_actual -= monto
       'Retiro Ahorro'  → cuentas_ahorro.saldo_actual += monto
       gasto con tarjeta → tarjetas_credito.deuda_actual -= monto
```

### Regla anti-duplicación de triggers
Los triggers en `ahorros_inversiones` son sensibles a duplicados (generan doble impacto).
Los únicos triggers permitidos en esa tabla son:
- `trg_tx_from_ahorro`
- `trg_update_saldo_ahorro`

Si se detecta cualquier otro, ejecutar `migration_v3_patch.sql`.

---

## 6. Motor Multi-Moneda (V4)

### Arquitectura de conversión

**Regla central:** `monto` en `ahorros_inversiones` y `transacciones` siempre se almacena en la moneda nativa del producto. La conversión ocurre **en el frontend antes del INSERT**, no en el trigger.

```
Usuario ingresa: 100 USD
Cuenta en:       PEN
─────────────────────────────────────────
getTodayRate()  → { compra: 3.68, venta: 3.72 }
montoFinal      = 100 × 3.72 = 372.00 PEN
INSERT: { monto: 372.00, moneda_original: 'USD', tipo_cambio: 3.72 }
```

Esto permite que los triggers existentes funcionen sin cambios.

### Servicio de tipo de cambio (`src/services/exchangeRate.ts`)

Cascada de fuentes (detiene en el primero que responde):

1. **Supabase `tipos_cambio`** — caché diaria por `fecha UNIQUE`
2. **Google Sheet del usuario** — regex sobre HTML/CSV buscando números en rango 3.0–4.5
3. **open.er-api.com** — `rates.PEN` ± spread de 0.02
4. **Fallback hardcoded** — `{ compra: 3.68, venta: 3.72 }`

La tasa encontrada se persiste en Supabase para evitar llamadas externas repetidas el mismo día.

### Consolidación en Dashboard

Para mostrar el balance total en PEN:

```typescript
function toPENAmount(tx: Transaccion): number {
  const m = Number(tx.monto);
  if ((tx.moneda ?? 'PEN') === 'PEN') return m;
  return m * (tx.tipo_cambio ?? rate.venta); // usa tasa histórica guardada
}
```

Usa `tipo_cambio` guardado en el momento del INSERT (precisión histórica), no la tasa del día.

---

## 7. Pantallas y Funcionalidades

### Dashboard (`app/(tabs)/index.tsx`)
- Hero card oscura (`#0F172A`) con balance total consolidado en PEN
- Sparklines: barras de View-based (sin librería) con datos de los últimos 7 días
- Chips de acciones rápidas (scroll horizontal): Registrar, Ahorrar, Pagar, Abonar
- Widget de presupuestos: barra tricolor (verde <70% / amarillo <90% / rojo ≥90%)
- 5 transacciones recientes
- FAB verde "＋ Quick Add" → bottom sheet con 4 acciones
- Modal de agregar/editar presupuesto

### Historial (`app/(tabs)/transacciones.tsx`)
- Agrupado por día (header de fecha + filas)
- Paginación de 30 registros
- Modal de edición (monto, categoría, descripción)
- Modal de confirmación para anular (dispara trigger de reversión)

### Cuentas (`app/(tabs)/cuentas.tsx`)
- Sección Ahorros (acento cyan) con saldo y meta
- Sección Tarjetas (acento rojo): bank badge con color por entidad, barra de uso
- Sección Préstamos (acento morado): progreso de cuotas
- FAB azul "＋" → bottom sheet → 3 modales de creación
- Modal de edición para cada producto

### Más (`app/(tabs)/mas.tsx`)
- Card de perfil con avatar inicial y modal de edición de nombre
- Selector de moneda base (8 monedas)
- Accesos directos a módulos
- Recordatorio de migraciones SQL pendientes
- Logout con modal de confirmación

### Registrar (`app/registrar.tsx`)
- Tipos: gasto, ingreso, transferencia
- Selector de categoría
- Selector de moneda [S/ PEN | $ USD] con hint de tasa en tiempo real
- Vincula tarjeta/cuenta si el método de pago lo requiere
- INSERT a `transacciones` + moneda + tipo_cambio

### Ahorros (`app/ahorros.tsx`)
- Selector de cuenta activa
- Subtipos: abono, retiro, interés
- Selector de moneda con hint de conversión en vivo
- Pre-convierte monto a la moneda de la cuenta antes del INSERT
- Banner de éxito post-operación
- Modal de edición de cuenta (nombre, meta)

---

## 8. Row Level Security (RLS)

Todas las tablas tienen RLS habilitado. Política general por tabla:

| Tabla | Política |
|---|---|
| profiles | ALL WHERE auth.uid() = id |
| tarjetas_credito | ALL WHERE auth.uid() = user_id |
| prestamos | ALL WHERE auth.uid() = user_id |
| cuentas_ahorro | SELECT/INSERT/DELETE + UPDATE (V3) WHERE auth.uid() = user_id |
| transacciones | SELECT/INSERT + UPDATE (V2) WHERE auth.uid() = user_id |
| ahorros_inversiones | ALL WHERE auth.uid() = user_id |
| presupuestos | ALL WHERE auth.uid() = user_id |
| tipos_cambio | SELECT/INSERT/UPDATE WHERE auth.role() = 'authenticated' (compartida) |
| pagos_tarjeta | ALL WHERE auth.uid() = user_id |
| prestamos_abonos | ALL WHERE auth.uid() = user_id |

**Nota:** Los triggers usan `SECURITY DEFINER` con `SET LOCAL row_security = off` porque `auth.uid()` devuelve NULL en contexto de trigger server-side.

---

## 9. Autenticación y Onboarding

1. Usuario se registra con número de celular (con código de país) + contraseña
2. Trigger en `auth.users` crea automáticamente un registro en `profiles`
3. Al iniciar sesión, el root layout verifica `perfil_completado`
4. Si es `false` → redirige a `onboarding.tsx` para capturar nombre + apellido
5. Al completar onboarding, `perfil_completado` se pone en `true`

---

## 10. Historial de Migraciones

| Archivo | Contenido | Estado |
|---|---|---|
| `migration_v2.sql` | Motor de conciliación completo: triggers, columnas fuente/prestamo_id/cuenta_ahorro_id, reversión por desactivación | Ejecutar |
| `migration_v2_patch.sql` | Correcciones adicionales de RLS | Ejecutar |
| `migration_v2_patch2.sql` | Fix trigger `trg_deuda_tarjeta` que sobreescribía la reversión | Ejecutar |
| `migration_v3.sql` | Tabla `presupuestos` + política UPDATE en `cuentas_ahorro` + DROP de triggers duplicados por nombre | Ejecutar |
| `migration_v3_patch.sql` | Limpieza nuclear: DROP de CUALQUIER trigger en `ahorros_inversiones` que no sea los dos canónicos | Ejecutar si hay doble impacto |
| `migration_v4.sql` | Columnas `moneda`/`tipo_cambio` en transacciones, ahorros, cuentas + tabla `tipos_cambio` con RLS | Ejecutar |

**Orden recomendado:** v2 → v2_patch → v2_patch2 → v3 → v3_patch (si aplica) → v4

---

## 11. Decisiones de Diseño Clave

### Single source of truth en transacciones
Todo flujo financiero (pagos, abonos, ahorros) genera una fila en `transacciones` vía trigger. Esto permite un historial unificado sin lógica dispersa en el frontend.

### Pre-conversión en frontend (multi-moneda)
En lugar de modificar los triggers para manejar monedas, el frontend convierte el monto a la moneda nativa de la cuenta antes del INSERT. Los triggers funcionan sin cambios y la trazabilidad se mantiene en columnas separadas.

### Tasa histórica vs. tasa del día
El dashboard usa `tx.tipo_cambio` (guardado en el INSERT) para consolidar en PEN, no la tasa del día. Esto garantiza que un USD registrado la semana pasada use la tasa de esa semana.

### Triggers SECURITY DEFINER
Requerido porque dentro de un trigger server-side, `auth.uid()` siempre devuelve NULL. La función debe tener permisos elevados y manejar el scope de RLS manualmente.

### No SVG, no librerías de charts
Los sparklines del dashboard son Views nativas con `flex: 1` y alturas proporcionales. Evita dependencias externas y funciona en todas las plataformas.

### useFocusEffect + useCallback para refetch
Todas las pantallas con datos usan `useFocusEffect(useCallback(() => { fetch(); }, []))` para recargar al volver al tab. Sin estado global ni contexto de React.

---

## 12. Variables de Entorno

```
EXPO_PUBLIC_SUPABASE_URL=https://<proyecto>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
```

Definidas en `.env.local` (no commiteado). El script de inicio en `package.json` las carga con `env: load .env.local`.

---

## 13. Ejecución Local

```bash
# Instalación
npm install

# Desarrollo en red local
npx expo start

# Con tunnel (acceso externo)
npx expo start --tunnel --port 8082
```

El QR code del tunnel permite acceso desde cualquier red escaneando con Expo Go.
