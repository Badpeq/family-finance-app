# Documento de Diseño Funcional
## Family Finance App — Aplicación de Finanzas Familiares

**Versión:** 1.0  
**Fecha:** 2026-06-18  
**Autor:** Equipo de Producto  
**Estado:** Producción (rama `v2-advanced`)

---

## 1. Propósito del Documento

Este documento describe el comportamiento funcional de la aplicación desde la perspectiva del usuario final. Está dirigido a arquitectos y líderes técnicos que necesitan comprender **qué hace** el sistema antes de tomar decisiones sobre **cómo construirlo o ampliarlo**.

---

## 2. Visión del Producto

Family Finance App es una aplicación móvil (iOS / Android) con versión web que permite a familias peruanas llevar un control completo de sus finanzas personales. Registra ingresos, gastos, deudas, ahorros y compromisos mensuales, con soporte nativo para manejo de múltiples monedas (PEN y USD).

### Usuarios objetivo
- Familias de clase media-alta en Perú
- Personas que tienen ingresos en dólares y gastos en soles
- Usuarios con tarjetas de crédito, préstamos y cuentas de ahorro activas

### Problema que resuelve
Los usuarios no saben cuánto gastan realmente, en qué categorías se van su dinero, cuánto deben en total (deuda real + compromisos fijos + proyección), ni si su presupuesto mensual está dentro de control.

---

## 3. Módulos Funcionales

### 3.1 Autenticación

| Flujo | Descripción |
|---|---|
| Registro | Número de teléfono + contraseña. Al crear cuenta se crea perfil con nombre/apellido via onboarding. |
| Login | Teléfono + contraseña. Sesión persistente hasta logout explícito. |
| Onboarding | Primera vez, si `perfil_completado = false`: pantalla para ingresar nombre y apellido. |
| Logout | Limpia sesión de Supabase y redirige a login. |

---

### 3.2 Dashboard (Inicio)

**Pantalla principal** que muestra el estado financiero del mes actual de un vistazo.

#### Secciones
1. **Encabezado del mes**: nombre del mes actual, opciones de navegación
2. **Balance del mes**: ingresos vs. gastos totales con diferencia neta
3. **Presupuestos por categoría**: tarjetas de progreso (gastado / límite) con barra de porcentaje
4. **Compromisos del mes**: próximos gastos fijos pendientes de cobro
5. **FAB "Anotar"**: botón flotante de acceso rápido a la pantalla de registro

#### Comportamiento
- Los presupuestos se cargan del mes actual. Si el usuario no tiene presupuestos configurados, la sección no aparece.
- Al tocar una tarjeta de presupuesto, navega a `categoria-detalle` con el desglose de gastos en esa categoría.
- Los compromisos muestran el estado de gastos recurrentes y cuotas programadas para el mes.
- Al tocar un compromiso, navega a la pantalla `compromisos`.

---

### 3.3 Registro de Transacciones

El usuario puede registrar 4 tipos de movimientos desde la pantalla `/registrar`:

#### Tab 1: Gasto Único
Registro de un gasto puntual ya realizado.

| Campo | Descripción |
|---|---|
| Monto | Numérico. Si la moneda es USD, se convierte automáticamente a PEN al guardar |
| Moneda | PEN / USD (toggle). Muestra la tasa del día y el equivalente en la otra moneda |
| Categoría | Lista de categorías del usuario (personalizables) |
| Subcategoría | Opcional, filtrada por la categoría seleccionada |
| Descripción | Texto libre |
| Método de pago | Efectivo / Tarjeta / Transferencia |
| Tarjeta | Si método = Tarjeta, selecciona qué tarjeta (suma a deuda de esa tarjeta automáticamente) |
| Fecha | Por defecto hoy; el usuario puede cambiarlo hacia atrás |

#### Tab 2: Gasto Recurrente
Registra un gasto que se repite mensualmente (suscripción, membresía, servicio).

| Campo | Descripción |
|---|---|
| Monto | Monto mensual |
| Categoría | Categoría del gasto |
| Descripción | Nombre del servicio (Netflix, Spotify, etc.) |
| Día de cobro | Día del mes en que se cobra |
| Mes de inicio | Mes desde el que aplica |
| Mes de fin | Opcional; si se deja vacío, es indefinido |

#### Tab 3: Compra en Cuotas
Registra una compra diferida en N cuotas mensuales.

| Campo | Descripción |
|---|---|
| Descripción | Nombre de la compra |
| Categoría | Categoría del gasto |
| Monto total | Monto completo de la compra |
| N° de cuotas | Número de meses en que se divide |
| Día de cobro | Día del mes en que cae la cuota |
| Mes de inicio | Mes de la primera cuota |
| Método de pago | Efectivo / Tarjeta |
| Tarjeta | Si método = Tarjeta, qué tarjeta |

El sistema calcula y muestra el monto por cuota antes de guardar.

#### Tab 4: Ingreso
Registro de un ingreso recibido.

| Campo | Descripción |
|---|---|
| Monto | Numérico |
| Moneda | PEN / USD |
| Categoría | Categorías de ingreso (Sueldo, Freelance, Transferencia, etc.) |
| Descripción | Texto libre |
| Fecha | Por defecto hoy |

---

### 3.4 Importar (OCR)

Permite registrar múltiples productos de una sola vez escaneando un ticket de supermercado o un voucher.

#### Flujo
1. Usuario selecciona **foto de ticket** o **foto de voucher**
2. La foto se envía a Google Vision API
3. El texto reconocido se parsea: extrae líneas de producto → cantidad, nombre, precio unitario, precio total
4. El usuario ve la lista de productos extraídos y puede editarlos o eliminar líneas erróneas
5. Al confirmar, se crea una transacción padre + N filas en `transaccion_detalles` (una por producto)
6. El monto total de la transacción es la suma de todos los ítems

---

### 3.5 Compromisos del Mes

Vista de todos los gastos fijos del mes actual:

| Sección | Contenido |
|---|---|
| Recurrentes | Suscripciones y gastos fijos configurados |
| Cuotas | Cuotas mensuales de compras diferidas |
| Estado | Cada ítem muestra si ya fue aplicado o está pendiente |

El usuario puede **anular** un compromiso desde aquí (lo marca como no aplicado para el mes). Los compromisos no anulados se procesan automáticamente cuando el día de cobro llega.

---

### 3.6 Análisis por Mes

Pantalla con 4 sub-pestañas de análisis financiero:

#### Pestaña 1: Resumen
- Selector de mes (pills horizontales con los últimos 6 meses)
- **Hero card oscura**: total de gastos del mes con sparkline de tendencia (últimos 6 meses)
- **Tarjetas Bento**: ingreso total, ahorro neto (ingreso − gasto), mayor gasto del mes
- **Distribución por categoría**: lista de categorías con monto, porcentaje sobre total y sparkline de tendencia

#### Pestaña 2: Categorías
- Selector de mes
- **Selector de categoría** (pills horizontales)
- **Hero card**: gasto de la categoría seleccionada en el mes con sparkline
- **Lista de subcategorías**: desglose del gasto por subcategoría
- **Lista de transacciones**: gastos individuales en esa categoría ese mes

#### Pestaña 3: Precios
- Selector de mes
- **Análisis de productos** de tickets importados
- Precio promedio, precio mínimo, precio máximo por producto
- Comparativa de precios entre meses (si hay histórico)

#### Pestaña 4: Deuda
- Selector de mes (mes actual + mes anterior)
- **Termómetro de 3 capas por categoría**:
  - Deuda real (ya gastado este mes)
  - Deuda presupuestada (límite del presupuesto)
  - Deuda proyectada (real + compromisos pendientes del mes)
- **Tarjeta de totales**: suma de las 3 capas en el mes seleccionado

---

### 3.7 Historial de Transacciones

Lista paginada de todas las transacciones del usuario:
- Agrupadas por día (headers de fecha)
- Distingue ingresos (verde) de gastos (rojo)
- Muestra ícono de categoría, descripción, monto y método de pago
- Permite **edición inline**: toca una transacción → edita monto, categoría, descripción, fecha
- Permite **anular**: swipe o botón → confirma → transacción pasa a inactiva y el sistema revierte el efecto en saldos
- Filtros: tipo (gasto/ingreso), ver anuladas

---

### 3.8 Cuentas

Vista consolidada del patrimonio financiero del usuario:

#### Sección Ahorros
- Lista de cuentas de ahorro con saldo actual
- Botón para hacer abono, retiro o registrar interés en cada cuenta
- Si hay meta de ahorro: progreso porcentual

#### Sección Tarjetas de Crédito
- Lista de tarjetas con deuda actual vs. límite de crédito
- Barra de utilización de crédito
- Botón para registrar pago de deuda

#### Sección Préstamos
- Lista de préstamos con saldo pendiente
- Progreso de cuotas pagadas vs. totales
- Botón para registrar abono de cuota

---

### 3.9 Gestión de Categorías

Pantalla de configuración de categorías de gasto:
- Ver lista de categorías activas (sistema + personalizadas)
- Crear nueva categoría con nombre e ícono (emoji)
- Agregar subcategorías a una categoría existente
- Eliminar categorías personalizadas (las del sistema no se pueden eliminar)

---

### 3.10 Presupuestos

Configuración mensual de límites de gasto por categoría:
- Se accede desde el Dashboard o desde la pantalla de categorías
- El usuario define un monto límite por categoría para el mes actual
- Los presupuestos pueden copiarse del mes anterior
- La app muestra alerta visual (barra roja) cuando se supera el 90% del límite

---

## 4. Reglas de Negocio

### 4.1 Multi-moneda
- El sistema mantiene todos los saldos internamente en PEN
- Si el usuario ingresa un monto en USD, la app lo convierte a PEN usando la tasa del día **en el momento del registro**
- La tasa usada se guarda junto a la transacción para preservar la exactitud histórica
- Los totales del dashboard siempre muestran la suma en PEN

### 4.2 Deuda de tarjeta
- Al registrar un gasto con tarjeta, la deuda de esa tarjeta aumenta automáticamente
- Al registrar un pago de tarjeta, la deuda disminuye automáticamente
- Al anular una transacción con tarjeta, la deuda se revierte automáticamente

### 4.3 Anulación de transacciones
- Una transacción anulada no se elimina físicamente; pasa a `activo = false`
- La anulación revierte el efecto en saldos de tarjetas, préstamos y cuentas de ahorro
- Las transacciones anuladas pueden verse con el filtro "ver anuladas" en el historial

### 4.4 Gastos recurrentes
- Un gasto recurrente sin mes de fin se repite indefinidamente hasta que el usuario lo desactive
- En la pantalla de Compromisos, el usuario puede anular la aplicación del gasto para un mes puntual sin eliminar el gasto recurrente

### 4.5 Cuotas
- Al registrar una compra en cuotas, el sistema divide el monto total entre N meses
- Cada mes, la cuota correspondiente aparece en la vista de Compromisos
- Cuando se pagan todas las cuotas, la compra se marca como completada automáticamente

### 4.6 Tipo de cambio (cascada de fuentes)
El sistema obtiene la tasa PEN/USD en este orden de prioridad:
1. Caché en base de datos (una vez al día)
2. Hoja de cálculo de Google del usuario (configurable)
3. API pública open.er-api.com
4. Valor de respaldo (`compra: 3.68, venta: 3.72`)

---

## 5. Flujos de Usuario Principales

### Flujo 1: Registro de un gasto cotidiano
```
Dashboard → FAB "Anotar" → Gasto Único
→ Ingresar monto + categoría + descripción
→ Guardar → Confirmación → Volver al Dashboard
```

### Flujo 2: Pago de tarjeta de crédito
```
Cuentas → Sección Tarjetas → [Tarjeta] → "Pagar"
→ Ingresar monto del pago
→ Guardar → Saldo de tarjeta decrece automáticamente
```

### Flujo 3: Análisis mensual
```
Tab Análisis → Pestaña Resumen → Seleccionar mes
→ Ver distribución → Tocar categoría
→ Pestaña Categorías filtra por esa categoría
→ Ver subcategorías y transacciones individuales
```

### Flujo 4: Importar ticket del supermercado
```
FAB "Anotar" → Importar → Ticket
→ Tomar foto
→ Revisar líneas detectadas → Editar si hay errores
→ Confirmar → Transacción con detalles guardada
```

### Flujo 5: Ver deuda total del mes
```
Tab Análisis → Pestaña Deuda → Seleccionar mes
→ Ver termómetro por categoría
→ Comparar real vs. presupuestado vs. proyectado
```

---

## 6. Criterios de Aceptación por Módulo

### Registro de transacciones
- [ ] El usuario puede registrar un gasto en menos de 30 segundos
- [ ] La conversión USD→PEN se muestra en tiempo real mientras escribe
- [ ] El monto por cuota se calcula automáticamente al cambiar total o número de cuotas

### Dashboard
- [ ] El balance del mes se actualiza inmediatamente tras registrar una transacción
- [ ] Los presupuestos muestran el porcentaje correcto gastado vs. límite
- [ ] La navegación a detalle de categoría funciona desde la tarjeta de presupuesto

### Análisis
- [ ] Los sparklines reflejan los últimos 6 meses de datos reales
- [ ] El drill-down de categoría muestra transacciones ordenadas por fecha descendente
- [ ] El termómetro de deuda suma correctamente real + proyectado

### Importación OCR
- [ ] El sistema extrae correctamente precio y nombre de al menos el 80% de los ítems de un ticket estándar
- [ ] El usuario puede editar/eliminar líneas antes de confirmar
- [ ] La suma de detalles coincide con el monto total de la transacción padre

---

## 7. Limitaciones Conocidas

| Limitación | Descripción |
|---|---|
| Solo PEN y USD | No soporta otras monedas extranjeras |
| OCR dependiente de calidad de foto | Tickets borrosos o con letra pequeña pueden extraer datos incorrectos |
| Tipo de cambio una vez al día | No actualiza en tiempo real (lo cual es correcto para transacciones históricas) |
| Presupuestos manuales | No hay sugerencia automática de presupuesto basada en historial |
| Sin categorización automática | El usuario debe asignar la categoría manualmente en cada gasto |
