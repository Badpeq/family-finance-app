-- ============================================================
-- PARCHE V3.1: Eliminación nuclear de triggers duplicados en ahorros_inversiones
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- ── Diagnóstico previo — muestra qué triggers existen HOY:
SELECT trigger_name, event_manipulation, action_timing
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table = 'ahorros_inversiones'
ORDER BY trigger_name;

-- ── Nuclear drop: elimina CUALQUIER trigger que no sea nuestros dos canónicos
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT trigger_name
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
      AND event_object_table = 'ahorros_inversiones'
      AND trigger_name NOT IN ('trg_tx_from_ahorro', 'trg_update_saldo_ahorro')
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.ahorros_inversiones', r.trigger_name);
    RAISE NOTICE 'Trigger eliminado: %', r.trigger_name;
  END LOOP;
END;
$$;

-- ── Verificación post-drop — deben aparecer SOLO estos dos:
-- trg_tx_from_ahorro      (crea la transacción en la tabla transacciones)
-- trg_update_saldo_ahorro (actualiza cuentas_ahorro.saldo_actual)
SELECT trigger_name, event_manipulation, action_timing
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table = 'ahorros_inversiones'
ORDER BY trigger_name;
