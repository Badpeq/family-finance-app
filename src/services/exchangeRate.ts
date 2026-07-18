/**
 * Servicio de tipo de cambio PEN/USD.
 *
 * El tipo de cambio es actualizado diariamente por la Edge Function
 * `actualizar-tipo-cambio` vía pg_cron. El cliente solo lee de la caché
 * en Supabase y usa un fallback local si no hay dato del día.
 */

import { supabase } from '@/lib/supabase';

export interface TipoCambio {
  fecha:   string;
  compra:  number;
  venta:   number;
  fuente?: string;
}

export const FALLBACK_RATE: TipoCambio = {
  fecha:  new Date().toISOString().slice(0, 10),
  compra: 3.68,
  venta:  3.72,
  fuente: 'fallback',
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Obtiene la tasa PEN/USD del día desde la caché de Supabase.
 * Si no hay dato para hoy (cron aún no corrió o falló), usa el fallback local.
 */
export async function getTodayRate(): Promise<TipoCambio> {
  const today = todayISO();
  const { data } = await supabase
    .from('tipos_cambio')
    .select('fecha, compra, venta, fuente')
    .eq('fecha', today)
    .single();

  if (data && (data as TipoCambio).compra > 0) return data as TipoCambio;
  return { ...FALLBACK_RATE, fecha: today };
}

export function toPEN(monto: number, moneda: string, rate: TipoCambio): number {
  if (moneda === 'PEN') return monto;
  if (moneda === 'USD') return parseFloat((monto * rate.venta).toFixed(2));
  return monto;
}

export function toUSD(monto: number, moneda: string, rate: TipoCambio): number {
  if (moneda === 'USD') return monto;
  if (moneda === 'PEN') return parseFloat((monto / rate.compra).toFixed(2));
  return monto;
}
