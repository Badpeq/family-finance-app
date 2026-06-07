-- ============================================================
-- PARCHE V2.2: Eliminar triggers duplicados + fix reversión
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- ── 1. ELIMINAR triggers del usuario que entran en conflicto ─
-- trg_pago_tarjeta:             duplica la reducción de deuda en pagos_tarjeta
-- trg_abono_prestamo:           duplica la reducción de saldo en prestamos_abonos
-- trg_deuda_tarjeta:            recalcula deuda en transacciones UPDATE,
--                               sobreescribiendo la reversión (culpable principal)
-- trg_reverse_deuda_on_deactivate: duplica la lógica de reversión
DROP TRIGGER IF EXISTS trg_pago_tarjeta             ON public.pagos_tarjeta;
DROP TRIGGER IF EXISTS trg_abono_prestamo            ON public.prestamos_abonos;
DROP TRIGGER IF EXISTS trg_deuda_tarjeta             ON public.transacciones;
DROP TRIGGER IF EXISTS trg_reverse_deuda_on_deactivate ON public.transacciones;

-- Funciones huérfanas asociadas (limpiar)
DROP FUNCTION IF EXISTS public.fn_apply_pago_tarjeta();
DROP FUNCTION IF EXISTS public.fn_apply_abono_prestamo();
DROP FUNCTION IF EXISTS public.fn_update_deuda_tarjeta();
DROP FUNCTION IF EXISTS public.fn_reverse_deuda_on_deactivate();

-- ── 2. Reemplazar fn_reverse_on_deactivate con row_security off ─
-- SET LOCAL row_security = off es necesario porque auth.uid() devuelve
-- NULL en contexto de trigger server-side, bloqueando UPDATE en
-- tablas con RLS aunque la función sea SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.fn_reverse_on_deactivate()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  SET LOCAL row_security = off;

  IF OLD.activo = true AND NEW.activo = false THEN

    IF OLD.categoria = 'Pago Tarjeta' AND OLD.tarjeta_id IS NOT NULL THEN
      UPDATE public.tarjetas_credito
        SET deuda_actual = deuda_actual + OLD.monto
        WHERE id = OLD.tarjeta_id;

    ELSIF OLD.categoria = 'Abono Préstamo' AND OLD.prestamo_id IS NOT NULL THEN
      UPDATE public.prestamos
        SET saldo_pendiente = saldo_pendiente + OLD.monto,
            cuotas_pagadas  = GREATEST(0, cuotas_pagadas - 1)
        WHERE id = OLD.prestamo_id;

    ELSIF OLD.categoria = 'Ahorro' AND OLD.cuenta_ahorro_id IS NOT NULL THEN
      UPDATE public.cuentas_ahorro
        SET saldo_actual = GREATEST(0, saldo_actual - OLD.monto)
        WHERE id = OLD.cuenta_ahorro_id;

    ELSIF OLD.categoria = 'Retiro Ahorro' AND OLD.cuenta_ahorro_id IS NOT NULL THEN
      UPDATE public.cuentas_ahorro
        SET saldo_actual = saldo_actual + OLD.monto
        WHERE id = OLD.cuenta_ahorro_id;

    ELSIF OLD.tipo = 'gasto' AND OLD.metodo_pago = 'tarjeta' AND OLD.tarjeta_id IS NOT NULL THEN
      UPDATE public.tarjetas_credito
        SET deuda_actual = GREATEST(0, deuda_actual - OLD.monto)
        WHERE id = OLD.tarjeta_id;
    END IF;

  END IF;
  RETURN NEW;
END; $$;

-- ── 3. Resto de funciones también con row_security off ───────
CREATE OR REPLACE FUNCTION public.fn_reduce_deuda_on_pago()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  SET LOCAL row_security = off;
  UPDATE public.tarjetas_credito
    SET deuda_actual = GREATEST(0, deuda_actual - NEW.monto)
    WHERE id = NEW.tarjeta_id;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.fn_reduce_saldo_on_abono()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  SET LOCAL row_security = off;
  UPDATE public.prestamos
    SET saldo_pendiente = GREATEST(0, saldo_pendiente - NEW.monto),
        cuotas_pagadas  = cuotas_pagadas + 1
    WHERE id = NEW.prestamo_id;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.fn_update_saldo_ahorro()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  SET LOCAL row_security = off;
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
