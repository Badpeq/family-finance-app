import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Llama fn_auto_apply_recurrentes una vez por sesión cuando el usuario ya está autenticado.
 * Inserta en transacciones los gastos recurrentes cuyo dia_cobro ya pasó este mes
 * y que aún no tienen una transacción vinculada.
 *
 * Retorna el número de transacciones insertadas (útil para mostrar un badge de "X gastos aplicados").
 */
export function useAutoApplyCommitments(onApplied?: (count: number) => void) {
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      ranRef.current = true;

      const { data, error } = await supabase.rpc('fn_auto_apply_recurrentes', {
        p_user_id: user.id,
      });

      if (error) {
        console.warn('[useAutoApplyCommitments]', error.message);
        return;
      }

      const inserted = typeof data === 'number' ? data : 0;
      if (inserted > 0) {
        console.log(`[useAutoApplyCommitments] ${inserted} gasto(s) recurrente(s) aplicados automáticamente.`);
        onApplied?.(inserted);
      }
    })();
  // Runs once per mount; ranRef prevents re-execution on re-renders
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
