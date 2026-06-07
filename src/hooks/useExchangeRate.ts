import { useState, useEffect } from 'react';
import { getTodayRate, TipoCambio, FALLBACK_RATE } from '@/services/exchangeRate';

export function useExchangeRate() {
  const [rate,    setRate]    = useState<TipoCambio>(FALLBACK_RATE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    getTodayRate().then(r => {
      if (mounted) { setRate(r); setLoading(false); }
    });
    return () => { mounted = false; };
  }, []);

  return { rate, loading };
}
