-- ============================================================
-- MIGRACIÓN V2: Motor de Conciliación + Historial Unificado
-- Ejecutar en Supabase SQL Editor (requiere rol postgres/service)
-- ============================================================

-- ── 1. CORRECCIÓN RLS transacciones (UPDATE policy) ─────────
-- El WITH CHECK correcto es solo user_id, sin restricción de activo
DROP POLICY IF EXISTS "transacciones_update_own" ON public.transacciones;
CREATE POLICY "transacciones_update_own" ON public.transacciones
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── 2. RLS UPDATE para tarjetas_credito y prestamos ─────────
DROP POLICY IF EXISTS "tarjetas_update_own" ON public.tarjetas_credito;
CREATE POLICY "tarjetas_update_own" ON public.tarjetas_credito
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "prestamos_update_own" ON public.prestamos;
CREATE POLICY "prestamos_update_own" ON public.prestamos
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── 3. Nuevas columnas en transacciones ─────────────────────
-- Para poder revertir abonos de préstamo y ahorro en historial
ALTER TABLE public.transacciones
  ADD COLUMN IF NOT EXISTS prestamo_id      UUID REFERENCES public.prestamos     ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cuenta_ahorro_id UUID REFERENCES public.cuentas_ahorro ON DELETE SET NULL;

-- ── 4a. Trigger: pagos_tarjeta → reduce deuda_actual ────────
-- Al registrar un pago, reduce la deuda de la tarjeta
CREATE OR REPLACE FUNCTION public.fn_reduce_deuda_on_pago()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.tarjetas_credito
    SET deuda_actual = GREATEST(0, deuda_actual - NEW.monto)
    WHERE id = NEW.tarjeta_id;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_reduce_deuda_on_pago ON public.pagos_tarjeta;
CREATE TRIGGER trg_reduce_deuda_on_pago
  AFTER INSERT ON public.pagos_tarjeta
  FOR EACH ROW EXECUTE FUNCTION public.fn_reduce_deuda_on_pago();

-- ── 4b. Trigger: prestamos_abonos → reduce saldo_pendiente ──
-- Al registrar un abono, reduce el saldo pendiente del préstamo
CREATE OR REPLACE FUNCTION public.fn_reduce_saldo_on_abono()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.prestamos
    SET saldo_pendiente = GREATEST(0, saldo_pendiente - NEW.monto),
        cuotas_pagadas  = cuotas_pagadas + 1
    WHERE id = NEW.prestamo_id;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_reduce_saldo_on_abono ON public.prestamos_abonos;
CREATE TRIGGER trg_reduce_saldo_on_abono
  AFTER INSERT ON public.prestamos_abonos
  FOR EACH ROW EXECUTE FUNCTION public.fn_reduce_saldo_on_abono();

-- ── 4c. Trigger: ahorros_inversiones → actualiza saldo_actual ─
CREATE OR REPLACE FUNCTION public.fn_update_saldo_ahorro()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.subtipo = 'abono' OR NEW.subtipo = 'interes' THEN
    UPDATE public.cuentas_ahorro
      SET saldo_actual = saldo_actual + NEW.monto
      WHERE id = NEW.cuenta_ahorro_id;
  ELSIF NEW.subtipo = 'retiro' THEN
    UPDATE public.cuentas_ahorro
      SET saldo_actual = GREATEST(0, saldo_actual - NEW.monto)
      WHERE id = NEW.cuenta_ahorro_id;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_update_saldo_ahorro ON public.ahorros_inversiones;
CREATE TRIGGER trg_update_saldo_ahorro
  AFTER INSERT ON public.ahorros_inversiones
  FOR EACH ROW EXECUTE FUNCTION public.fn_update_saldo_ahorro();

-- ── 6. Trigger: pagos_tarjeta → transacciones ───────────────
-- Inserta el pago como gasto en el historial general
CREATE OR REPLACE FUNCTION public.fn_tx_from_pago_tarjeta()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.transacciones
    (user_id, tipo, monto, categoria, descripcion, metodo_pago, tarjeta_id, fuente)
  VALUES
    (NEW.user_id, 'gasto', NEW.monto, 'Pago Tarjeta',
     COALESCE(NEW.descripcion, 'Pago de tarjeta'), 'tarjeta', NEW.tarjeta_id, 'pago_tarjeta')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_tx_from_pago_tarjeta ON public.pagos_tarjeta;
CREATE TRIGGER trg_tx_from_pago_tarjeta
  AFTER INSERT ON public.pagos_tarjeta
  FOR EACH ROW EXECUTE FUNCTION public.fn_tx_from_pago_tarjeta();

-- ── 7. Trigger: prestamos_abonos → transacciones ────────────
CREATE OR REPLACE FUNCTION public.fn_tx_from_abono_prestamo()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT user_id INTO v_user_id FROM public.prestamos WHERE id = NEW.prestamo_id;
  INSERT INTO public.transacciones
    (user_id, tipo, monto, categoria, descripcion, prestamo_id, fuente)
  VALUES
    (v_user_id, 'gasto', NEW.monto, 'Abono Préstamo',
     COALESCE(NEW.descripcion, 'Abono de préstamo'), NEW.prestamo_id, 'abono_prestamo')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_tx_from_abono_prestamo ON public.prestamos_abonos;
CREATE TRIGGER trg_tx_from_abono_prestamo
  AFTER INSERT ON public.prestamos_abonos
  FOR EACH ROW EXECUTE FUNCTION public.fn_tx_from_abono_prestamo();

-- ── 8. Trigger: ahorros_inversiones → transacciones ─────────
-- Abono de ahorro = gasto del cash; Retiro = ingreso al cash
-- Interés ganado NO afecta cash general
CREATE OR REPLACE FUNCTION public.fn_tx_from_ahorro()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.subtipo = 'abono' THEN
    INSERT INTO public.transacciones
      (user_id, tipo, monto, categoria, descripcion, cuenta_ahorro_id, fuente)
    VALUES
      (NEW.user_id, 'gasto', NEW.monto, 'Ahorro',
       COALESCE(NEW.descripcion, 'Abono a ahorro'), NEW.cuenta_ahorro_id, 'ahorro_abono')
    ON CONFLICT DO NOTHING;
  ELSIF NEW.subtipo = 'retiro' THEN
    INSERT INTO public.transacciones
      (user_id, tipo, monto, categoria, descripcion, cuenta_ahorro_id, fuente)
    VALUES
      (NEW.user_id, 'ingreso', NEW.monto, 'Retiro Ahorro',
       COALESCE(NEW.descripcion, 'Retiro de ahorro'), NEW.cuenta_ahorro_id, 'ahorro_retiro')
    ON CONFLICT DO NOTHING;
  -- subtipo = 'interes': no afecta cash, solo saldo de cuenta
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_tx_from_ahorro ON public.ahorros_inversiones;
CREATE TRIGGER trg_tx_from_ahorro
  AFTER INSERT ON public.ahorros_inversiones
  FOR EACH ROW EXECUTE FUNCTION public.fn_tx_from_ahorro();

-- ── 9. Trigger: reversión al desactivar transacciones ────────
-- Cuando activo cambia de true a false, revierte el efecto
-- en la deuda de tarjeta, saldo de préstamo o saldo de ahorro
CREATE OR REPLACE FUNCTION public.fn_reverse_on_deactivate()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF OLD.activo = true AND NEW.activo = false THEN
    IF OLD.categoria = 'Pago Tarjeta' AND OLD.tarjeta_id IS NOT NULL THEN
      -- Restaurar deuda (el pago se revierte)
      UPDATE public.tarjetas_credito
        SET deuda_actual = deuda_actual + OLD.monto
        WHERE id = OLD.tarjeta_id;

    ELSIF OLD.categoria = 'Abono Préstamo' AND OLD.prestamo_id IS NOT NULL THEN
      -- Restaurar saldo pendiente
      UPDATE public.prestamos
        SET saldo_pendiente = saldo_pendiente + OLD.monto,
            cuotas_pagadas  = GREATEST(0, cuotas_pagadas - 1)
        WHERE id = OLD.prestamo_id;

    ELSIF OLD.categoria = 'Ahorro' AND OLD.cuenta_ahorro_id IS NOT NULL THEN
      -- El abono se revierte: reducir saldo de la cuenta
      UPDATE public.cuentas_ahorro
        SET saldo_actual = GREATEST(0, saldo_actual - OLD.monto)
        WHERE id = OLD.cuenta_ahorro_id;

    ELSIF OLD.categoria = 'Retiro Ahorro' AND OLD.cuenta_ahorro_id IS NOT NULL THEN
      -- El retiro se revierte: restituir saldo a la cuenta
      UPDATE public.cuentas_ahorro
        SET saldo_actual = saldo_actual + OLD.monto
        WHERE id = OLD.cuenta_ahorro_id;

    ELSIF OLD.tipo = 'gasto' AND OLD.metodo_pago = 'tarjeta' AND OLD.tarjeta_id IS NOT NULL THEN
      -- Gasto corriente con tarjeta: reducir deuda
      UPDATE public.tarjetas_credito
        SET deuda_actual = GREATEST(0, deuda_actual - OLD.monto)
        WHERE id = OLD.tarjeta_id;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_reverse_on_deactivate ON public.transacciones;
CREATE TRIGGER trg_reverse_on_deactivate
  AFTER UPDATE OF activo ON public.transacciones
  FOR EACH ROW EXECUTE FUNCTION public.fn_reverse_on_deactivate();

-- ── 10. Columna fuente (trazabilidad) ───────────────────────
ALTER TABLE public.transacciones
  ADD COLUMN IF NOT EXISTS fuente TEXT DEFAULT 'manual';
-- Valores: 'manual', 'pago_tarjeta', 'abono_prestamo', 'ahorro_abono', 'ahorro_retiro'
