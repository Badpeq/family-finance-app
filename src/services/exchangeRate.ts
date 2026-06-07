/**
 * Servicio de tipo de cambio PEN/USD.
 *
 * Estrategia (en cascada):
 *   1. Caché local Supabase (tipos_cambio) — evita llamadas externas repetidas.
 *   2. URL de Google Sheets proporcionada por el usuario.
 *   3. API pública open.er-api.com (USD base, sin autenticación).
 *   4. Tasa de referencia hardcoded como último recurso.
 *
 * El campo `monto` en transacciones/ahorros se almacena en la moneda
 * de entrada del usuario. Para el Dashboard, convertir a PEN multiplicando
 * por `tipo_cambio.venta` cuando moneda = 'USD'.
 */

import { supabase } from '@/lib/supabase';

export interface TipoCambio {
  fecha:   string;
  compra:  number;
  venta:   number;
  fuente?: string;
}

// URL proporcionada por el usuario — Google Sheets compartido con tasa del día.
// Configurar en .env.local como EXPO_PUBLIC_GOOGLE_SHEET_URL.
// Si está publicado como CSV (Archivo → Publicar en la web → CSV),
// la respuesta será texto separado por comas directamente parseable.
const GOOGLE_SHEET_URL = process.env.EXPO_PUBLIC_GOOGLE_SHEET_URL ?? '';

// API pública gratuita sin autenticación. Devuelve tasas relativas a USD.
const ER_API_URL = 'https://open.er-api.com/v6/latest/USD';

// Tasa de referencia cuando ninguna fuente está disponible.
export const FALLBACK_RATE: TipoCambio = {
  fecha:  new Date().toISOString().slice(0, 10),
  compra: 3.68,
  venta:  3.72,
  fuente: 'fallback',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Extrae dos números en el rango típico PEN/USD (3.0 – 4.5) de un string.
 * Funciona con HTML de Google Sheets o con CSV simple de dos columnas.
 */
function extractRatesFromText(text: string): { compra: number; venta: number } | null {
  // Intentar primero formato CSV: dos números separados por coma/tab/espacio
  const csvMatch = text.match(/(3\.\d{2,4}|4\.[0-4]\d{1,3})[,\t ]+?(3\.\d{2,4}|4\.[0-4]\d{1,3})/);
  if (csvMatch) {
    const a = parseFloat(csvMatch[1]);
    const b = parseFloat(csvMatch[2]);
    if (a > 0 && b > 0 && Math.abs(a - b) < 0.5) {
      return { compra: Math.min(a, b), venta: Math.max(a, b) };
    }
  }
  // Fallback: buscar todos los números en rango y tomar el menor/mayor
  const all = (text.match(/\b(3\.\d{2,4}|4\.[0-4]\d{1,3})\b/g) ?? []).map(Number);
  const valid = all.filter(n => n >= 3.0 && n <= 4.5);
  if (valid.length >= 2) {
    return { compra: Math.min(...valid), venta: Math.max(...valid) };
  }
  return null;
}

// ── Fuentes externas ──────────────────────────────────────────────────────────

async function fetchFromGoogleSheet(): Promise<TipoCambio | null> {
  if (!GOOGLE_SHEET_URL) return null;
  try {
    const res  = await fetch(GOOGLE_SHEET_URL, { redirect: 'follow' });
    const text = await res.text();
    const pair = extractRatesFromText(text);
    if (pair) {
      return { fecha: todayISO(), ...pair, fuente: 'google_sheet' };
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchFromErAPI(): Promise<TipoCambio | null> {
  try {
    const res  = await fetch(ER_API_URL);
    const json = await res.json();
    if (json?.result === 'success' && typeof json?.rates?.PEN === 'number') {
      const mid: number = json.rates.PEN;
      // El spread típico en Perú es ~0.04 soles
      return {
        fecha:   todayISO(),
        compra:  parseFloat((mid - 0.02).toFixed(4)),
        venta:   parseFloat((mid + 0.02).toFixed(4)),
        fuente:  'er-api',
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ── Caché Supabase ────────────────────────────────────────────────────────────

async function getCachedRate(fecha: string): Promise<TipoCambio | null> {
  const { data } = await supabase
    .from('tipos_cambio')
    .select('fecha, compra, venta, fuente')
    .eq('fecha', fecha)
    .single();
  return data as TipoCambio | null;
}

async function saveCachedRate(rate: TipoCambio): Promise<void> {
  await supabase.from('tipos_cambio').upsert(
    { fecha: rate.fecha, compra: rate.compra, venta: rate.venta, fuente: rate.fuente ?? 'api' },
    { onConflict: 'fecha' }
  );
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Obtiene la tasa PEN/USD del día.
 * Intenta Supabase caché → Google Sheet → er-api → fallback.
 * La tasa encontrada se guarda en Supabase para evitar llamadas externas
 * posteriores en el mismo día.
 */
export async function getTodayRate(): Promise<TipoCambio> {
  const today = todayISO();

  // 1. Caché local
  const cached = await getCachedRate(today);
  if (cached && cached.compra > 0 && cached.venta > 0) return cached;

  // 2. Google Sheet del usuario
  const fromGoogle = await fetchFromGoogleSheet();
  if (fromGoogle) {
    await saveCachedRate(fromGoogle);
    return fromGoogle;
  }

  // 3. open.er-api.com
  const fromAPI = await fetchFromErAPI();
  if (fromAPI) {
    await saveCachedRate(fromAPI);
    return fromAPI;
  }

  // 4. Fallback hardcoded — no se guarda en caché para reintentar mañana
  return { ...FALLBACK_RATE, fecha: today };
}

/**
 * Convierte un monto de USD a PEN usando la tasa venta del día.
 * Si moneda = 'PEN' devuelve el monto sin cambio.
 */
export function toPEN(monto: number, moneda: string, rate: TipoCambio): number {
  if (moneda === 'PEN') return monto;
  if (moneda === 'USD') return parseFloat((monto * rate.venta).toFixed(2));
  return monto; // Otras monedas: sin conversión por ahora
}

/**
 * Convierte de PEN a USD usando la tasa compra del día.
 */
export function toUSD(monto: number, moneda: string, rate: TipoCambio): number {
  if (moneda === 'USD') return monto;
  if (moneda === 'PEN') return parseFloat((monto / rate.compra).toFixed(2));
  return monto;
}
