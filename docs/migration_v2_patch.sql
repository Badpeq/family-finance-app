-- ============================================================
-- PARCHE V2: Triggers de actualización de saldos
-- Ejecutar en Supabase SQL Editor DESPUÉS de migration_v2.sql
-- ============================================================

-- ── Pago de Tarjeta → reduce deuda_actual ────────────────────
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

-- ── Abono de Préstamo → reduce saldo_pendiente ───────────────
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

-- ── Movimiento de Ahorro → actualiza saldo_actual ────────────
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
