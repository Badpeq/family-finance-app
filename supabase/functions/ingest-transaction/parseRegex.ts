/**
 * Extracción por regex de correos bancarios peruanos con plantillas fijas.
 * Ahorra ~80 % de llamadas a Claude para los bancos más comunes.
 * Si no matchea ningún patrón, devuelve null → el caller llama a Claude.
 */

import type { ParsedTransaction } from './parseText.ts';

interface BankPattern {
  name: string;
  pattern: RegExp;
  extract: (m: RegExpMatchArray) => Partial<ParsedTransaction> | null;
}

const PATTERNS: BankPattern[] = [
  // ── BCP ──────────────────────────────────────────────────────────────────
  {
    name: 'BCP_cargo',
    pattern: /Realizaste un cargo de (S\/|USD)\s*([\d,]+\.?\d*)\s+en\s+(.+?)\s+con tu .+?terminada en (\d{4})/i,
    extract: (m) => ({
      monto:             parseAmount(m[2]),
      moneda:            m[1].trim() === 'USD' ? 'USD' : 'PEN',
      comercio:          cleanMerchant(m[3]),
      ultimos_4_digitos: m[4],
    }),
  },
  {
    name: 'BCP_compra',
    pattern: /Compraste (S\/|USD)\s*([\d,]+\.?\d*)\s+en\s+(.+?)\s+con .+?terminada en (\d{4})/i,
    extract: (m) => ({
      monto:             parseAmount(m[2]),
      moneda:            m[1].trim() === 'USD' ? 'USD' : 'PEN',
      comercio:          cleanMerchant(m[3]),
      ultimos_4_digitos: m[4],
    }),
  },

  // ── BBVA ─────────────────────────────────────────────────────────────────
  {
    name: 'BBVA_consumo',
    pattern: /consumo\s+(?:por\s+)?(S\/|USD|PEN|\$)\s*([\d,]+\.?\d*)\s+en\s+(.+?)\s+con tu tarjeta .+?(\d{4})/i,
    extract: (m) => ({
      monto:             parseAmount(m[2]),
      moneda:            m[1].trim() === '$' || m[1].trim() === 'USD' ? 'USD' : 'PEN',
      comercio:          cleanMerchant(m[3]),
      ultimos_4_digitos: m[4],
    }),
  },
  {
    name: 'BBVA_cargo',
    pattern: /cargo\s+(?:de\s+)?(S\/|USD|PEN|\$)\s*([\d,]+\.?\d*)\s+en\s+(.+?)\s+(?:con|de) .+?(\d{4})/i,
    extract: (m) => ({
      monto:             parseAmount(m[2]),
      moneda:            m[1].trim() === '$' || m[1].trim() === 'USD' ? 'USD' : 'PEN',
      comercio:          cleanMerchant(m[3]),
      ultimos_4_digitos: m[4],
    }),
  },

  // ── Interbank ─────────────────────────────────────────────────────────────
  {
    name: 'Interbank_consumo',
    pattern: /consumo\s+de\s+(S\/|USD)\s*([\d,]+\.?\d*)\s+en\s+(.+?)\s+con tu Tarjeta.+?(\d{4})/i,
    extract: (m) => ({
      monto:             parseAmount(m[2]),
      moneda:            m[1].trim() === 'USD' ? 'USD' : 'PEN',
      comercio:          cleanMerchant(m[3]),
      ultimos_4_digitos: m[4],
    }),
  },

  // ── Scotiabank ───────────────────────────────────────────────────────────
  {
    name: 'Scotiabank_cargo',
    pattern: /cargo\s+(?:de\s+)?(S\/|USD)\s*([\d,.]+)\s+a\s+(.+?)\s+tarjeta.+?(\d{4})/i,
    extract: (m) => ({
      monto:             parseAmount(m[2]),
      moneda:            m[1].trim() === 'USD' ? 'USD' : 'PEN',
      comercio:          cleanMerchant(m[3]),
      ultimos_4_digitos: m[4],
    }),
  },

  // ── Yape (notificación push) ─────────────────────────────────────────────
  {
    name: 'Yape_pago',
    pattern: /Pagaste\s+S\/\s*([\d,.]+)\s+a\s+(.+)/i,
    extract: (m) => ({
      monto:             parseAmount(m[1]),
      moneda:            'PEN',
      comercio:          cleanMerchant(m[2]),
      ultimos_4_digitos: null,
    }),
  },
  {
    name: 'Yape_recibo',
    pattern: /Yape\s+de\s+S\/\s*([\d,.]+)\s+(?:de|para)\s+(.+)/i,
    extract: (m) => ({
      monto:             parseAmount(m[1]),
      moneda:            'PEN',
      comercio:          cleanMerchant(m[2]),
      ultimos_4_digitos: null,
    }),
  },

  // ── BanBif ───────────────────────────────────────────────────────────────
  {
    name: 'BanBif_compra',
    pattern: /compra\s+(?:de\s+)?(S\/|USD)\s*([\d,.]+)\s+en\s+(.+?)\s+tarjeta.+?(\d{4})/i,
    extract: (m) => ({
      monto:             parseAmount(m[2]),
      moneda:            m[1].trim() === 'USD' ? 'USD' : 'PEN',
      comercio:          cleanMerchant(m[3]),
      ultimos_4_digitos: m[4],
    }),
  },
];

/** Intenta extraer la transacción por regex. Devuelve null si ningún patrón aplica. */
export function tryParseWithRegex(rawText: string): ParsedTransaction | null {
  for (const { pattern, extract } of PATTERNS) {
    const match = rawText.match(pattern);
    if (!match) continue;

    const partial = extract(match);
    if (!partial?.monto || partial.monto <= 0 || partial.monto > 500_000) continue;

    const comercio = partial.comercio ?? 'Sin nombre';
    return {
      monto:              partial.monto,
      moneda:             partial.moneda ?? 'PEN',
      comercio:           comercio.slice(0, 120),
      ultimos_4_digitos:  partial.ultimos_4_digitos ?? null,
      tipo:               'gasto',
      categoria_sugerida: null,
      confianza:          null,
    };
  }
  return null;
}

// ── Utilidades ──────────────────────────────────────────────────────────────

function parseAmount(s: string): number {
  return parseFloat(s.replace(/,/g, ''));
}

function cleanMerchant(s: string): string {
  return s.trim().replace(/\s{2,}/g, ' ').replace(/[.,]+$/, '');
}
