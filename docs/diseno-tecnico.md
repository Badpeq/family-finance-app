# Documento de Diseño Técnico
## Family Finance App — Replicación e Implementación

**Versión:** 2.0  
**Fecha:** 2026-07-12  
**Dirigido a:** Desarrolladores y Arquitectos de Software  
**Stack:** React Native + Expo SDK 56 + Supabase + Vercel

---

## 1. Objetivo

Este documento describe la implementación técnica completa de Family Finance App, con suficiente detalle para que un desarrollador pueda replicar el sistema desde cero. Cubre la arquitectura de datos, lógica de backend (triggers), patrones de código del frontend, y decisiones de diseño con su justificación.

---

## 2. Stack y Dependencias

### Dependencias principales (`package.json`)

```json
{
  "dependencies": {
    "expo": "~56.0.9",
    "expo-router": "~56.2.9",
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "react-native": "0.85.3",
    "react-native-web": "^0.21.2",
    "@supabase/supabase-js": "^2.107.0",
    "react-native-svg": "15.15.4",
    "@expo/vector-icons": "^15.0.2",
    "@react-native-community/datetimepicker": "9.1.0",
    "expo-sqlite": "~56.0.4",
    "expo-notifications": "~56.0.16",
    "expo-constants": "~56.0.17",
    "expo-linking": "~56.0.13",
    "expo-status-bar": "~56.0.4",
    "react-native-safe-area-context": "~5.7.0",
    "react-native-screens": "4.25.2"
  }
}
```

> **Nota:** `@react-native-community/datetimepicker` se usa solo en iOS/Android. En web se importa via `require()` condicional dentro de `DatePickerNative` para evitar errores en el bundle web.

### Configuración de Expo Router (`app.json`)

```json
{
  "expo": {
    "scheme": "family-finance",
    "plugins": ["expo-router"],
    "web": { "bundler": "metro", "output": "static" }
  }
}
```

### Alias TypeScript (`tsconfig.json`)

```json
{
  "compilerOptions": {
    "paths": { "@/*": ["./src/*"] }
  }
}
```

---

## 3. Configuración de Supabase

### Cliente (`src/lib/supabase.ts`)

```typescript
import { createClient } from '@supabase/supabase-js';
import * as SQLite from 'expo-sqlite';

// Polyfill para AsyncStorage con SQLite (requerido en Expo SDK 56)
const ExpoSQLiteAdapter = {
  getItem: async (key: string) => {
    const db = await SQLite.openDatabaseAsync('supabase-auth');
    const result = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM kv WHERE key = ?`, [key]
    );
    return result?.value ?? null;
  },
  setItem: async (key: string, value: string) => {
    const db = await SQLite.openDatabaseAsync('supabase-auth');
    await db.runAsync(
      `INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)`, [key, value]
    );
  },
  removeItem: async (key: string) => {
    const db = await SQLite.openDatabaseAsync('supabase-auth');
    await db.runAsync(`DELETE FROM kv WHERE key = ?`, [key]);
  },
};

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { storage: ExpoSQLiteAdapter, persistSession: true, autoRefreshToken: true } }
);
```

---

## 4. Esquema SQL Completo

### 4.1 Setup Inicial

```sql
-- Tabla de perfiles (trigger la crea al registrar usuario)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  nombre TEXT,
  apellido TEXT,
  telefono TEXT,
  moneda_base VARCHAR(3) DEFAULT 'PEN',
  ingreso_mensual NUMERIC,
  presupuesto_template JSONB DEFAULT '{}',
  modulo_ahorros BOOLEAN DEFAULT false,
  modulo_prestamos BOOLEAN DEFAULT false,
  modulo_tarjetas BOOLEAN DEFAULT true,
  perfil_completado BOOLEAN DEFAULT false,
  creado_en TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_self" ON profiles FOR ALL USING (auth.uid() = id);

-- Trigger para crear perfil automáticamente al registrar
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, telefono)
  VALUES (NEW.id, NEW.phone);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
```

### 4.2 Tablas Principales

```sql
CREATE TABLE transacciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('ingreso', 'gasto')),
  monto NUMERIC(12,2) NOT NULL,
  categoria TEXT NOT NULL,
  subcategoria_id UUID REFERENCES subcategorias(id),
  descripcion TEXT,
  metodo_pago TEXT DEFAULT 'efectivo',
  tarjeta_id UUID REFERENCES tarjetas_credito(id),
  prestamo_id UUID REFERENCES prestamos(id),
  cuenta_ahorro_id UUID REFERENCES cuentas_ahorro(id),
  gastos_recurrentes_id UUID REFERENCES gastos_recurrentes(id),
  fuente TEXT DEFAULT 'manual',
  moneda VARCHAR(3) DEFAULT 'PEN',
  tipo_cambio NUMERIC(8,4),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  es_gasto_unico BOOLEAN DEFAULT false,
  fuente_raw TEXT,
  activo BOOLEAN DEFAULT true,
  creado_en TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE transaccion_detalles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaccion_id UUID NOT NULL REFERENCES transacciones(id) ON DELETE CASCADE,
  producto TEXT NOT NULL,
  cantidad NUMERIC DEFAULT 1,
  precio_unitario NUMERIC NOT NULL,
  precio_total NUMERIC NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE tarjetas_credito (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  nombre_banco TEXT NOT NULL,
  ultimos_4 VARCHAR(4),
  limite_credito NUMERIC(12,2) DEFAULT 0,
  deuda_actual NUMERIC(12,2) DEFAULT 0,
  fecha_corte INTEGER,
  fecha_pago INTEGER,
  dia_cierre INTEGER CHECK (dia_cierre BETWEEN 1 AND 31), -- V9: día de cierre del ciclo
  moneda VARCHAR(3) DEFAULT 'PEN',
  activo BOOLEAN DEFAULT true
);

CREATE TABLE presupuestos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  categoria TEXT NOT NULL,
  monto_limite NUMERIC(12,2) NOT NULL,
  periodo DATE NOT NULL,
  seguimiento_diario BOOLEAN DEFAULT false,
  UNIQUE (user_id, categoria, periodo)
);

CREATE TABLE gastos_recurrentes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  monto NUMERIC(12,2) NOT NULL,
  categoria TEXT NOT NULL,
  descripcion TEXT,
  dia_cobro INTEGER,
  mes_inicio DATE,
  mes_fin DATE,
  aplicado BOOLEAN DEFAULT false,
  creado_en TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE compras_cuotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  descripcion TEXT NOT NULL,
  categoria TEXT NOT NULL,
  monto_total NUMERIC(12,2) NOT NULL,
  monto_cuota NUMERIC(12,2) NOT NULL,
  total_cuotas INTEGER NOT NULL,
  cuotas_pagadas INTEGER DEFAULT 0,
  dia_cobro INTEGER,
  mes_inicio DATE,
  metodo_pago TEXT DEFAULT 'efectivo',
  tarjeta_id UUID REFERENCES tarjetas_credito(id),
  activo BOOLEAN DEFAULT true
);

CREATE TABLE tipos_cambio (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha DATE UNIQUE NOT NULL,
  compra NUMERIC(8,4),
  venta NUMERIC(8,4),
  fuente TEXT,
  creado_en TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE cuentas_ahorro (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  nombre_cuenta TEXT NOT NULL,
  banco TEXT,
  saldo_actual NUMERIC(12,2) DEFAULT 0,
  saldo_meta NUMERIC(12,2),
  moneda VARCHAR(3) DEFAULT 'PEN',
  activo BOOLEAN DEFAULT true
);

CREATE TABLE ahorros_inversiones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  cuenta_ahorro_id UUID NOT NULL REFERENCES cuentas_ahorro(id),
  subtipo TEXT NOT NULL CHECK (subtipo IN ('abono', 'retiro', 'interes')),
  monto NUMERIC(12,2) NOT NULL,
  descripcion TEXT,
  moneda_original VARCHAR(3),
  tipo_cambio NUMERIC(8,4),
  creado_en TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE prestamos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  nombre_entidad TEXT NOT NULL,
  monto_original NUMERIC(12,2) NOT NULL,
  saldo_pendiente NUMERIC(12,2) NOT NULL,
  cuotas_totales INTEGER,
  cuotas_pagadas INTEGER DEFAULT 0,
  monto_cuota NUMERIC(12,2),
  tasa_interes NUMERIC(6,4),
  fecha_inicio DATE
);

CREATE TABLE categorias_personalizadas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  nombre TEXT NOT NULL,
  icono TEXT,
  es_personalizada BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE subcategorias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  categoria_nombre TEXT NOT NULL,
  nombre TEXT NOT NULL,
  creado_en TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE pagos_tarjeta (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  tarjeta_id UUID NOT NULL REFERENCES tarjetas_credito(id),
  monto NUMERIC(12,2) NOT NULL,
  descripcion TEXT,
  creado_en TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE prestamos_abonos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  prestamo_id UUID NOT NULL REFERENCES prestamos(id),
  monto NUMERIC(12,2) NOT NULL,
  descripcion TEXT,
  creado_en TIMESTAMPTZ DEFAULT now()
);
```

### 4.3 Vistas

```sql
-- Vista de categorías combinando sistema + personalizadas
-- Crear en Supabase Dashboard con security_invoker = true
CREATE VIEW v_categorias AS
SELECT
  c.nombre,
  c.icono,
  c.sort_order,
  c.es_sistema
FROM (
  VALUES
    ('Alimentación', '🛒', 1, true),
    ('Transporte', '🚗', 2, true),
    ('Salud', '💊', 3, true),
    ('Educación', '📚', 4, true),
    ('Entretenimiento', '🎮', 5, true),
    ('Servicios', '💡', 6, true),
    ('Ropa', '👕', 7, true),
    ('Hogar', '🏠', 8, true),
    ('Mascotas', '🐾', 9, true),
    ('Viajes', '✈️', 10, true),
    ('Restaurantes', '🍽️', 11, true),
    ('Ahorro', '💰', 12, true),
    ('Pago Tarjeta', '💳', 13, true),
    ('Otros', '📦', 99, true)
) AS c(nombre, icono, sort_order, es_sistema)
UNION ALL
SELECT
  cp.nombre,
  cp.icono,
  100 + ROW_NUMBER() OVER (PARTITION BY cp.user_id ORDER BY cp.created_at) AS sort_order,
  false AS es_sistema
FROM categorias_personalizadas cp
WHERE cp.user_id = auth.uid();

-- Vista de compromisos del mes actual (V9 — aplicado dinámico vía EXISTS)
-- Crear en Supabase Dashboard con security_invoker = true
-- IMPORTANTE: en gastos_recurrentes la columna es 'activo' (no 'aplicado')
-- IMPORTANTE: en compras_cuotas la columna es 'cuota_actual' (no 'cuotas_pagadas')
CREATE VIEW public.v_gastos_programados_mes
WITH (security_invoker = true) AS
SELECT
  gr.id,
  'recurrente'::TEXT                AS tipo_programado,
  gr.descripcion,
  gr.categoria,
  gr.monto                          AS monto_cuota,
  gr.dia_cobro,
  EXISTS (
    SELECT 1
    FROM public.transacciones t
    WHERE t.gastos_recurrentes_id = gr.id
      AND t.activo = true
      AND t.fecha >= date_trunc('month', CURRENT_DATE)::date
      AND t.fecha  < (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month')::date
  )                                 AS aplicado
FROM public.gastos_recurrentes gr
WHERE gr.user_id   = auth.uid()
  AND gr.activo    = true
  AND gr.mes_inicio <= date_trunc('month', CURRENT_DATE)::date
  AND (gr.mes_fin IS NULL OR gr.mes_fin >= date_trunc('month', CURRENT_DATE)::date)

UNION ALL

SELECT
  cc.id,
  'cuota'::TEXT                     AS tipo_programado,
  cc.descripcion,
  cc.categoria,
  cc.monto_cuota,
  cc.dia_cobro,
  -- aplicado si cuota_actual >= número de cuota esperado este mes
  (
    cc.cuota_actual >= (
      (EXTRACT(YEAR  FROM CURRENT_DATE) - EXTRACT(YEAR  FROM cc.mes_inicio)) * 12 +
       EXTRACT(MONTH FROM CURRENT_DATE) - EXTRACT(MONTH FROM cc.mes_inicio)
    )
  )                                 AS aplicado
FROM public.compras_cuotas cc
WHERE cc.user_id    = auth.uid()
  AND cc.mes_inicio <= CURRENT_DATE
  AND cc.cuota_actual < cc.total_cuotas;
```

### 4.4 Función RPC: Termómetro de Deuda

```sql
CREATE OR REPLACE FUNCTION fn_deuda_capas(p_mes DATE)
RETURNS TABLE (
  categoria TEXT,
  deuda_real NUMERIC,
  deuda_presupuestada NUMERIC,
  deuda_proyectada NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  WITH uid AS (SELECT auth.uid() AS u),
  mes_inicio AS (SELECT date_trunc('month', p_mes)::DATE AS d),
  mes_fin AS (SELECT (date_trunc('month', p_mes) + INTERVAL '1 month - 1 day')::DATE AS d),

  real_gastos AS (
    SELECT t.categoria, SUM(t.monto) AS total
    FROM transacciones t, uid
    WHERE t.user_id = uid.u
      AND t.tipo = 'gasto'
      AND t.activo = true
      AND t.fecha BETWEEN (SELECT d FROM mes_inicio) AND CURRENT_DATE
      AND date_trunc('month', t.fecha) = date_trunc('month', p_mes)
    GROUP BY t.categoria
  ),

  presupuesto AS (
    SELECT p.categoria, p.monto_limite AS total
    FROM presupuestos p, uid
    WHERE p.user_id = uid.u
      AND p.periodo = date_trunc('month', p_mes)::DATE
  ),

  pendientes AS (
    SELECT g.categoria, SUM(g.monto) AS total
    FROM v_gastos_programados_mes g
    WHERE g.aplicado = false
    GROUP BY g.categoria
  )

  SELECT
    COALESCE(r.categoria, p.categoria, pe.categoria) AS categoria,
    COALESCE(r.total, 0) AS deuda_real,
    COALESCE(p.total, 0) AS deuda_presupuestada,
    COALESCE(r.total, 0) + COALESCE(pe.total, 0) AS deuda_proyectada
  FROM real_gastos r
  FULL OUTER JOIN presupuesto p ON r.categoria = p.categoria
  FULL OUTER JOIN pendientes pe ON COALESCE(r.categoria, p.categoria) = pe.categoria
  ORDER BY COALESCE(r.total, 0) DESC;
END;
$$;
```

### 4.5 Función RPC: Auto-aplicar Gastos Recurrentes (V9)

```sql
-- Idempotente: no crea duplicados si ya existe transacción en el mes.
-- Llamar desde el frontend al montar Dashboard o Compromisos.
CREATE OR REPLACE FUNCTION public.fn_auto_apply_recurrentes(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inserted INTEGER := 0;
  r          RECORD;
  v_mes_ini  DATE := date_trunc('month', CURRENT_DATE)::DATE;
  v_mes_fin  DATE := (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month')::DATE;
BEGIN
  FOR r IN
    SELECT gr.id, gr.monto, gr.categoria, gr.descripcion, gr.dia_cobro
    FROM public.gastos_recurrentes gr
    WHERE gr.user_id    = p_user_id
      AND gr.activo     = true
      AND gr.mes_inicio <= v_mes_ini
      AND (gr.mes_fin IS NULL OR gr.mes_fin >= v_mes_ini)
      AND gr.dia_cobro  <= EXTRACT(DAY FROM CURRENT_DATE)
      AND NOT EXISTS (
        SELECT 1 FROM public.transacciones t
        WHERE t.gastos_recurrentes_id = gr.id
          AND t.activo = true
          AND t.fecha >= v_mes_ini AND t.fecha < v_mes_fin
      )
  LOOP
    INSERT INTO public.transacciones (
      user_id, tipo, monto, categoria, descripcion,
      metodo_pago, fecha, moneda, tipo_cambio, es_gasto_unico,
      gastos_recurrentes_id, fuente, activo
    ) VALUES (
      p_user_id, 'gasto', r.monto, r.categoria, r.descripcion,
      'efectivo',
      LEAST(
        (v_mes_ini + (r.dia_cobro - 1) * INTERVAL '1 day')::DATE,
        (v_mes_fin  - INTERVAL '1 day')::DATE
      ),
      'PEN', 1.0, false, r.id, 'auto_recurrente', true
    );
    v_inserted := v_inserted + 1;
  END LOOP;
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_auto_apply_recurrentes(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_auto_apply_recurrentes(UUID) TO authenticated;
```

**Uso desde el frontend:**

```typescript
// src/hooks/useAutoApplyCommitments.ts
import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export function useAutoApplyCommitments() {
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.rpc('fn_auto_apply_recurrentes', { p_user_id: user.id });
    })();
  }, []); // Solo al montar
}
```

---

## 5. Triggers del Motor de Conciliación

```sql
-- IMPORTANTE: Todos los triggers usan SECURITY DEFINER
-- porque auth.uid() devuelve NULL en contexto de trigger server-side.

-- 1. Pago de tarjeta → reduce deuda
CREATE OR REPLACE FUNCTION trg_reduce_deuda_on_pago()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET LOCAL row_security = off AS $$
BEGIN
  UPDATE tarjetas_credito
  SET deuda_actual = deuda_actual - NEW.monto
  WHERE id = NEW.tarjeta_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_pago_tarjeta
  AFTER INSERT ON pagos_tarjeta
  FOR EACH ROW EXECUTE FUNCTION trg_reduce_deuda_on_pago();

-- 2. Pago de tarjeta → crea transacción
CREATE OR REPLACE FUNCTION trg_tx_from_pago_tarjeta()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET LOCAL row_security = off AS $$
BEGIN
  INSERT INTO transacciones (user_id, tipo, monto, categoria, descripcion, fuente, tarjeta_id, fecha)
  VALUES (NEW.user_id, 'gasto', NEW.monto, 'Pago Tarjeta',
          COALESCE(NEW.descripcion, 'Pago de tarjeta'), 'pago_tarjeta', NEW.tarjeta_id, CURRENT_DATE);
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_pago_tarjeta_tx
  AFTER INSERT ON pagos_tarjeta
  FOR EACH ROW EXECUTE FUNCTION trg_tx_from_pago_tarjeta();

-- 3. Abono de préstamo → reduce saldo
CREATE OR REPLACE FUNCTION trg_reduce_saldo_on_abono()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET LOCAL row_security = off AS $$
BEGIN
  UPDATE prestamos
  SET saldo_pendiente = saldo_pendiente - NEW.monto,
      cuotas_pagadas = cuotas_pagadas + 1
  WHERE id = NEW.prestamo_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_abono_prestamo
  AFTER INSERT ON prestamos_abonos
  FOR EACH ROW EXECUTE FUNCTION trg_reduce_saldo_on_abono();

-- 4. Abono de préstamo → crea transacción
CREATE OR REPLACE FUNCTION trg_tx_from_abono_prestamo()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET LOCAL row_security = off AS $$
BEGIN
  INSERT INTO transacciones (user_id, tipo, monto, categoria, descripcion, fuente, prestamo_id, fecha)
  VALUES (NEW.user_id, 'gasto', NEW.monto, 'Abono Préstamo',
          COALESCE(NEW.descripcion, 'Cuota de préstamo'), 'abono_prestamo', NEW.prestamo_id, CURRENT_DATE);
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_abono_prestamo_tx
  AFTER INSERT ON prestamos_abonos
  FOR EACH ROW EXECUTE FUNCTION trg_tx_from_abono_prestamo();

-- 5. Ahorro/retiro → actualiza saldo de cuenta
CREATE OR REPLACE FUNCTION trg_update_saldo_ahorro()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET LOCAL row_security = off AS $$
BEGIN
  IF NEW.subtipo = 'abono' OR NEW.subtipo = 'interes' THEN
    UPDATE cuentas_ahorro SET saldo_actual = saldo_actual + NEW.monto WHERE id = NEW.cuenta_ahorro_id;
  ELSIF NEW.subtipo = 'retiro' THEN
    UPDATE cuentas_ahorro SET saldo_actual = saldo_actual - NEW.monto WHERE id = NEW.cuenta_ahorro_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_ahorro_saldo
  AFTER INSERT ON ahorros_inversiones
  FOR EACH ROW EXECUTE FUNCTION trg_update_saldo_ahorro();

-- 6. Ahorro/retiro → crea transacción (solo abono y retiro, no interés)
CREATE OR REPLACE FUNCTION trg_tx_from_ahorro()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET LOCAL row_security = off AS $$
BEGIN
  IF NEW.subtipo = 'interes' THEN RETURN NEW; END IF;
  INSERT INTO transacciones (user_id, tipo, monto, categoria, descripcion, fuente, cuenta_ahorro_id, fecha)
  VALUES (
    NEW.user_id,
    CASE WHEN NEW.subtipo = 'abono' THEN 'gasto' ELSE 'ingreso' END,
    NEW.monto,
    CASE WHEN NEW.subtipo = 'abono' THEN 'Ahorro' ELSE 'Retiro Ahorro' END,
    COALESCE(NEW.descripcion, 'Movimiento de ahorro'),
    CASE WHEN NEW.subtipo = 'abono' THEN 'ahorro_abono' ELSE 'ahorro_retiro' END,
    NEW.cuenta_ahorro_id,
    CURRENT_DATE
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_ahorro_tx
  AFTER INSERT ON ahorros_inversiones
  FOR EACH ROW EXECUTE FUNCTION trg_tx_from_ahorro();

-- 7. Anulación de transacción → revierte efecto
CREATE OR REPLACE FUNCTION trg_reverse_on_deactivate()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET LOCAL row_security = off AS $$
BEGIN
  IF OLD.activo = true AND NEW.activo = false THEN
    IF NEW.categoria = 'Pago Tarjeta' AND NEW.tarjeta_id IS NOT NULL THEN
      UPDATE tarjetas_credito SET deuda_actual = deuda_actual + NEW.monto WHERE id = NEW.tarjeta_id;
    ELSIF NEW.categoria = 'Abono Préstamo' AND NEW.prestamo_id IS NOT NULL THEN
      UPDATE prestamos SET saldo_pendiente = saldo_pendiente + NEW.monto, cuotas_pagadas = cuotas_pagadas - 1
      WHERE id = NEW.prestamo_id;
    ELSIF NEW.categoria = 'Ahorro' AND NEW.cuenta_ahorro_id IS NOT NULL THEN
      UPDATE cuentas_ahorro SET saldo_actual = saldo_actual - NEW.monto WHERE id = NEW.cuenta_ahorro_id;
    ELSIF NEW.categoria = 'Retiro Ahorro' AND NEW.cuenta_ahorro_id IS NOT NULL THEN
      UPDATE cuentas_ahorro SET saldo_actual = saldo_actual + NEW.monto WHERE id = NEW.cuenta_ahorro_id;
    ELSIF NEW.tipo = 'gasto' AND NEW.tarjeta_id IS NOT NULL THEN
      UPDATE tarjetas_credito SET deuda_actual = deuda_actual - NEW.monto WHERE id = NEW.tarjeta_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_tx_deactivate
  BEFORE UPDATE ON transacciones
  FOR EACH ROW EXECUTE FUNCTION trg_reverse_on_deactivate();
```

---

## 6. Patrones de Código Frontend

### 6.1 Patrón de carga de datos: `useFocusEffect`

Todo screen que muestra datos remotos sigue este patrón para recargar al volver al tab:

```typescript
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

export default function MiScreen() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const { data: rows } = await supabase
          .from('transacciones')
          .select('*')
          .order('fecha', { ascending: false });
        if (!cancelled) setData(rows ?? []);
        setLoading(false);
      })();
      return () => { cancelled = true; };
    }, [])
  );

  // render...
}
```

### 6.2 Design Tokens

```typescript
const C = {
  hero:    '#080C10',  // Fondo de hero cards oscuras
  screen:  '#F7F8FA',  // Fondo de pantallas
  card:    '#FFFFFF',  // Fondo de tarjetas/cards
  accent:  '#3B82F6',  // Azul principal (botones, sparklines)
  success: '#22C55E',  // Verde (ingresos, positivo)
  danger:  '#EF4444',  // Rojo (gastos, alertas)
  text:    '#111827',  // Texto principal
  muted:   '#6B7280',  // Texto secundario
};
```

### 6.3 Multi-moneda en formularios

```typescript
import { useExchangeRate } from '@/hooks/useExchangeRate';

function FormRegistrar() {
  const { rate } = useExchangeRate();
  const [monto, setMonto] = useState('');
  const [moneda, setMoneda] = useState<'PEN' | 'USD'>('PEN');

  const montoFinal = moneda === 'USD'
    ? parseFloat(monto) * (rate?.venta ?? 3.72)
    : parseFloat(monto);

  const handleGuardar = async () => {
    await supabase.from('transacciones').insert({
      monto: montoFinal,          // Siempre en PEN
      moneda,                     // Moneda original del usuario
      tipo_cambio: rate?.venta,   // Tasa usada (para historial)
      // ...resto de campos
    });
  };
}
```

### 6.4 `SparklineChart` — uso

```typescript
import SparklineChart from '@/components/SparklineChart';

// Datos de los últimos 6 meses en PEN
const valores = [1200, 1500, 1100, 1800, 1650, 1400];

<SparklineChart
  values={valores}
  color="#3B82F6"
  width={100}
  height={40}
  filled={true}
  strokeWidth={1.5}
  showDot={true}
/>
```

### 6.5 `DatePickerInput` — componente de selección de fecha (V2)

Componente único (`src/components/DatePickerInput.tsx`) que adapta el picker de fecha a la plataforma.

```typescript
// Props
interface Props {
  value: string;           // YYYY-MM-DD (vacío = sin selección)
  onChange: (iso: string) => void;
  inputStyle?: object;
  placeholder?: string;
}

// Uso
import { DatePickerInput } from '@/components/DatePickerInput';

<DatePickerInput
  value={fecha}              // estado en ISO YYYY-MM-DD
  onChange={setFecha}
  inputStyle={styles.input}
  placeholder="Seleccionar fecha"
/>
```

**Implementación por plataforma:**
- **Web** (`Platform.OS === 'web'`): renderiza `<input type="date">` HTML nativo con estilos inline que replican el design token del formulario
- **Native** (iOS/Android): renderiza un `TouchableOpacity` con la fecha en DD/MM/YYYY; al tocar abre `DateTimePicker` de `@react-native-community/datetimepicker` con `display="spinner"` y `locale="es-PE"`
- **Importante:** el `require('@react-native-community/datetimepicker')` está dentro del componente nativo para que Metro no lo incluya en el bundle web

**Archivos que usan `DatePickerInput`:**
- `app/(tabs)/cuentas.tsx` — ciclo Desde/Hasta por tarjeta
- `src/components/TransactionsList.tsx` — edición inline de fecha
- `app/pagos.tsx` — fecha del pago
- `app/prestamos.tsx` — fecha del abono
- `app/importar.tsx` — fecha de la transacción importada

### 6.6 Patrón OR para `fecha` nula en consultas de ciclo

Algunas transacciones antiguas tienen `fecha = NULL` y dependen de `creado_en`. Para no perder esas filas en las consultas de rango:

```typescript
// En cuentas.tsx — loadCicloCustom
const { data } = await supabase
  .from('transacciones')
  .select('*')
  .eq('user_id', userId)
  .eq('tipo', 'gasto')
  .eq('activo', true)
  .or(
    `and(fecha.gte.${desdeStr},fecha.lt.${hastaStr}),` +
    `and(fecha.is.null,creado_en.gte.${desdeStr},creado_en.lt.${hastaStr})`
  );
```

### 6.7 Fórmula de run-rate para proyección de ciclo

```typescript
// Separar fijos (recurrentes) de variables (resto)
const expensesFijos = gastos
  .filter(g => g.gastos_recurrentes_id !== null)
  .reduce((s, g) => s + toMoneda(g), 0);

const expensesVar = gastos
  .filter(g => g.gastos_recurrentes_id === null && !g.es_gasto_unico)
  .reduce((s, g) => s + toMoneda(g), 0);

const expensesUnicos = gastos
  .filter(g => g.es_gasto_unico)
  .reduce((s, g) => s + toMoneda(g), 0);

const diasTranscurridos = Math.max(1, daysBetween(desde, hoy));
const diasRestantes = Math.max(0, daysBetween(hoy, hasta));
const dailyRate = expensesVar / diasTranscurridos;

const proyectado = (dailyRate * diasRestantes) + expensesFijos + expensesUnicos + pendingCommits;
```

Los gastos fijos (`gastos_recurrentes_id IS NOT NULL`) tienen monto definido — proyectarlos con run-rate los doblaría incorrectamente.

### 6.8 `useCategorias` — uso

```typescript
import { useCategorias, iconForCat } from '@/hooks/useCategorias';

function PickerCategorias() {
  const { categorias, loading } = useCategorias();

  return categorias.map(cat => (
    <TouchableOpacity key={cat.nombre}>
      <Text>{iconForCat(cat.nombre, categorias)} {cat.nombre}</Text>
    </TouchableOpacity>
  ));
}
```

### 6.9 Patrón de transacciones cancelables (`compromisos.tsx`)

Los gastos recurrentes que el usuario anula en la vista se guardan en un `Set` module-level para que persistan entre re-mounts:

```typescript
// A nivel de módulo (fuera del componente) — persiste entre re-renders
const _cancelledIds = new Set<string>();

export default function CompromisosScreen() {
  const handleCancelar = (id: string) => {
    _cancelledIds.add(id);
    // Actualizar estado local para UI inmediata
    setCompromisos(prev => prev.filter(c => c.id !== id));
  };

  // En useFocusEffect: filtrar los ya cancelados
  const filtrados = data.filter(c => !_cancelledIds.has(c.id));
}
```

---

## 7. OCR de Tickets (`src/lib/ocrImage.ts` y `parseVoucher.ts`)

### Flujo técnico

```
expo-image-picker (takePhotoAsync)
  ↓ base64 de la foto
Google Vision API (DOCUMENT_TEXT_DETECTION)
  ↓ fullTextAnnotation.text (string plano)
parseVoucher(text)
  ↓ RegEx para extraer: nombre_producto, cantidad, precio
Array de { producto, cantidad, precio_unitario, precio_total }
  ↓
supabase.from('transacciones').insert(padre)
supabase.from('transaccion_detalles').insert(detalles[])
```

### `parseVoucher` — estructura del parser

```typescript
export function parseVoucher(text: string): DetalleItem[] {
  const lines = text.split('\n').filter(l => l.trim());
  const items: DetalleItem[] = [];

  for (const line of lines) {
    // Patrón: "NOMBRE DEL PRODUCTO  2  5.90  11.80"
    const match = line.match(/^(.+?)\s+(\d+)\s+([\d.]+)\s+([\d.]+)$/);
    if (match) {
      items.push({
        producto: match[1].trim(),
        cantidad: parseFloat(match[2]),
        precio_unitario: parseFloat(match[3]),
        precio_total: parseFloat(match[4]),
      });
    }
  }
  return items;
}
```

---

## 8. Tipo de Cambio (`src/services/exchangeRate.ts`)

```typescript
export async function getTodayRate(): Promise<{ compra: number; venta: number }> {
  const hoy = new Date().toISOString().split('T')[0];

  // 1. Caché en Supabase
  const { data } = await supabase
    .from('tipos_cambio')
    .select('compra, venta')
    .eq('fecha', hoy)
    .single();
  if (data) return data;

  // 2. Google Sheet del usuario (si está configurado)
  if (process.env.EXPO_PUBLIC_GOOGLE_SHEET_URL) {
    const rate = await fetchFromGoogleSheet();
    if (rate) {
      await supabase.from('tipos_cambio').insert({ fecha: hoy, ...rate, fuente: 'google_sheet' });
      return rate;
    }
  }

  // 3. API pública
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    const json = await res.json();
    const venta = json.rates.PEN;
    const rate = { compra: venta - 0.02, venta };
    await supabase.from('tipos_cambio').insert({ fecha: hoy, ...rate, fuente: 'er-api' });
    return rate;
  } catch (_) {}

  // 4. Fallback
  return { compra: 3.68, venta: 3.72 };
}
```

---

## 9. WhatsApp Webhook (Supabase Edge Function)

Módulo V8 para auto-captura de comprobantes Yape/Plin desde WhatsApp.

### Estructura

```
supabase/functions/whatsapp-webhook/
├── index.ts          # Entry point: webhook Meta → validación HMAC → orquestación
├── providers.ts      # Adaptador Meta Cloud API: parse de mensaje, download media, reply
├── parseImage.ts     # Claude claude-haiku-4-5-20251001 visión → JSON { monto, operacion_id, descripcion, tipo }
└── deno.json         # Import map Deno (esm.sh)
```

### Flujo técnico

```
Meta Cloud API (POST /whatsapp-webhook)
  ↓ Validar HMAC-SHA256 con WHATSAPP_SECRET
providers.ts: parsear mensaje → extraer media_id
  ↓ Descargar imagen desde Meta Graph API
parseImage.ts: enviar a Claude haiku visión → JSON
  ↓ { monto, operacion_id, descripcion, tipo: 'yape'|'plin' }
Buscar usuario por telefono_whatsapp en profiles
  ↓
INSERT en transacciones:
  { monto, categoria: 'Por clasificar', fuente: 'whatsapp_yape'|'whatsapp_plin',
    operacion_id, descripcion, activo: true }
ON CONFLICT (user_id, operacion_id) DO NOTHING  ← idempotencia
```

### Variables de entorno (Supabase Edge Function)

```bash
WHATSAPP_TOKEN=<Meta access token>
WHATSAPP_SECRET=<App secret para HMAC>
WHATSAPP_PHONE_ID=<ID del número de WhatsApp Business>
ANTHROPIC_API_KEY=<API key de Anthropic>
SUPABASE_URL=<url del proyecto>
SUPABASE_SERVICE_ROLE_KEY=<service role key>  # necesario para saltar RLS
```

### Deploy de Edge Function

```bash
supabase functions deploy whatsapp-webhook --project-ref tsdawpxiqqnesikcqlex
```

---

## 10. Deploy

### Vercel (`vercel.json`)

```json
{
  "buildCommand": "npx expo export --platform web",
  "outputDirectory": "dist",
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

### Deploy manual (sin GitHub auto-deploy)

```bash
# Desde la rama correcta (v2-advanced o main)
vercel --prod
```

El flag `--prod` bypasea el preview y publica directamente en producción. Útil cuando GitHub auto-deploy está configurado para otra rama.

### Variables de entorno en Vercel

Configurar en Vercel Dashboard → Project Settings → Environment Variables:
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_GOOGLE_SHEET_URL` (opcional)

**Importante:** Las variables con prefijo `EXPO_PUBLIC_` se inyectan en el bundle de JS (client-side). No usar para secretos reales.

---

## 10. Row Level Security — Políticas Completas

```sql
-- Habilitar RLS en todas las tablas
ALTER TABLE transacciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaccion_detalles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tarjetas_credito ENABLE ROW LEVEL SECURITY;
ALTER TABLE presupuestos ENABLE ROW LEVEL SECURITY;
ALTER TABLE gastos_recurrentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE compras_cuotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE categorias_personalizadas ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcategorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuentas_ahorro ENABLE ROW LEVEL SECURITY;
ALTER TABLE ahorros_inversiones ENABLE ROW LEVEL SECURITY;
ALTER TABLE prestamos ENABLE ROW LEVEL SECURITY;
ALTER TABLE prestamos_abonos ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos_tarjeta ENABLE ROW LEVEL SECURITY;
ALTER TABLE tipos_cambio ENABLE ROW LEVEL SECURITY;

-- Políticas generales: usuario solo ve sus datos
CREATE POLICY "user_own" ON transacciones FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "user_own" ON tarjetas_credito FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "user_own" ON presupuestos FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "user_own" ON gastos_recurrentes FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "user_own" ON compras_cuotas FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "user_own" ON categorias_personalizadas FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "user_own" ON subcategorias FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "user_own" ON cuentas_ahorro FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "user_own" ON ahorros_inversiones FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "user_own" ON prestamos FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "user_own" ON prestamos_abonos FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "user_own" ON pagos_tarjeta FOR ALL USING (auth.uid() = user_id);

-- transaccion_detalles: acceso via JOIN a transacciones
CREATE POLICY "details_via_tx" ON transaccion_detalles FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM transacciones t
      WHERE t.id = transaccion_id AND t.user_id = auth.uid()
    )
  );

-- tipos_cambio: compartida entre usuarios autenticados
CREATE POLICY "authenticated_read" ON tipos_cambio FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated_insert" ON tipos_cambio FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "authenticated_update" ON tipos_cambio FOR UPDATE
  USING (auth.role() = 'authenticated');
```

---

## 11. Guía de Replicación (Paso a Paso)

### Paso 1: Supabase
1. Crear proyecto en [supabase.com](https://supabase.com) — ref del proyecto actual: `tsdawpxiqqnesikcqlex`
2. Ejecutar SQLs en este orden en el SQL Editor:
   - `migration_deploy.sql`
   - `migration_v2.sql` → `migration_v2_patch.sql` → `migration_v2_patch2.sql`
   - `migration_v3.sql` → `migration_v3_patch.sql`
   - `migration_v4.sql` → `migration_v5.sql` → `migration_v6.sql` → `migration_v7.sql`
   - `migration_v8.sql` ← WhatsApp: `telefono_whatsapp` en profiles + `operacion_id` en transacciones
   - `migration_v9.sql` ← V2 avanzado: vista `v_gastos_programados_mes` con `aplicado` dinámico + `fn_auto_apply_recurrentes` + `dia_cierre` en tarjetas
3. Crear vista `v_categorias` en SQL Editor con `security_invoker = true`
   > Nota: `v_gastos_programados_mes` y `fn_deuda_capas` y `fn_auto_apply_recurrentes` ya están en los archivos de migración
4. Copiar `URL` y `anon key` del proyecto

### Paso 2: Google Vision API (para OCR)
1. Crear proyecto en Google Cloud Console
2. Habilitar Vision API
3. Crear API Key sin restricciones de referrer (o con referrer del dominio de Vercel)
4. Guardar la key en variable de entorno del proyecto Expo

### Paso 3: Proyecto Expo
```bash
npx create-expo-app family-finance-app --template tabs
cd family-finance-app
npx expo install @supabase/supabase-js expo-sqlite react-native-svg \
  @expo/vector-icons expo-notifications expo-image-picker expo-file-system \
  @react-native-community/datetimepicker
```

### Paso 4: Variables de entorno
```bash
# .env.local (no commitear)
EXPO_PUBLIC_SUPABASE_URL=https://<tu-proyecto>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
EXPO_PUBLIC_GOOGLE_VISION_KEY=<vision-api-key>
EXPO_PUBLIC_GOOGLE_SHEET_URL=<url-hoja-tipo-cambio>  # opcional
```

### Paso 5: WhatsApp webhook (opcional)
```bash
# Variables en Supabase Edge Functions
supabase secrets set WHATSAPP_TOKEN=... WHATSAPP_SECRET=... \
  WHATSAPP_PHONE_ID=... ANTHROPIC_API_KEY=... \
  --project-ref <tu-proyecto-ref>

# Deploy
supabase functions deploy whatsapp-webhook --project-ref <tu-proyecto-ref>
```

### Paso 6: Deploy web
```bash
# Instalar Vercel CLI
npm i -g vercel

# Login y deploy
vercel login
vercel --prod --yes
```

**URL de producción actual:** https://family-finance-app-ruby.vercel.app

---

## 12. Decisiones Técnicas y Justificación

| Decisión | Alternativa considerada | Razón de la elección |
|---|---|---|
| Triggers para lógica de negocio | Edge Functions / cliente | Atomicidad garantizada, sin round-trips, sin riesgo de estado inconsistente si el app cierra a mitad |
| `useFocusEffect` para refetch | Context API / React Query | Simplicidad: sin estado global, recarga siempre fresca al volver al tab |
| `react-native-svg` para sparklines | Victory Native / Recharts | Victory Native tiene conflictos con Expo SDK 56; Recharts es web-only. SVG puro es más ligero |
| Tasa de cambio guardada en INSERT | Recalcular con tasa actual | Exactitud histórica: si consulto un gasto de hace 6 meses, debe verse en la tasa de ese momento |
| `SET module-level` para cancelados | State o localStorage | Persiste entre re-mounts del componente sin persistencia en DB (la anulación es temporal por sesión) |
| Pre-conversión en frontend | Trigger de conversión en DB | Los triggers no tienen acceso a la tasa del día sin llamada externa; más simple y trazable en el cliente |
| `activo = false` en lugar de DELETE | DELETE físico | Permite auditoría, recuperación de errores y reversión de efectos secundarios vía trigger |
| `SECURITY DEFINER` en triggers | `SECURITY INVOKER` | `auth.uid()` devuelve NULL en contexto server-side de trigger; DEFINER corre como owner del schema |
| `aplicado` dinámico en vista V9 | Columna `aplicado` en `gastos_recurrentes` | La columna booleana en la tabla necesitaba UPDATE manual y podía quedar dessincronizada; el EXISTS en la vista es siempre correcto |
| `require()` condicional para DateTimePicker | Archivos `.web.tsx`/`.native.tsx` | TypeScript no resuelve automáticamente platform suffixes sin un archivo base; un único archivo con `Platform.OS` es más simple |
| Separar `expensesFijos` del run-rate | Un solo run-rate diario para todo | Los gastos recurrentes tienen monto definido — incluirlos en el promedio diario y luego proyectar los duplicaría en la proyección |
| Claude haiku para parsing WhatsApp | RegEx / parser determinístico | Los comprobantes Yape/Plin varían en formato; visión AI es más robusta ante variaciones de layout |
| `operacion_id` UNIQUE por user en transacciones | Deduplicar en Edge Function | Garantía de idempotencia en DB aunque el webhook se llame dos veces por el mismo comprobante |

---

## 13. Historial de Versiones del Documento

| Versión | Fecha | Cambios |
|---|---|---|
| 1.0 | 2026-06-27 | Documento inicial — stack, SQL completo V1-V7, triggers, patrones frontend, OCR, tipo de cambio, deploy, RLS, guía de replicación |
| 2.0 | 2026-07-12 | Dependencias actualizadas (react-native 0.85.3, @react-native-community/datetimepicker 9.1.0), `v_gastos_programados_mes` V9 con `aplicado` dinámico, `fn_auto_apply_recurrentes` RPC (§4.5), `dia_cierre` en `tarjetas_credito`, sección WhatsApp webhook (§9), `DatePickerInput` component (§6.5), OR filter para `fecha` nula (§6.6), fórmula run-rate fijos vs. variables (§6.7), guía de replicación actualizada con migration_v8/v9, URL de producción, nuevas decisiones técnicas |
