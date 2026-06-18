/**
 * M7/M9-Lib · exchangeRate
 * Cubre: toPEN, toUSD, FALLBACK_RATE
 */

// Mock supabase para evitar que expo-sqlite (ESM) rompa el runner de Jest
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }), upsert: async () => ({}) }),
  },
}));

import { toPEN, toUSD, FALLBACK_RATE, type TipoCambio } from '@/services/exchangeRate';

const RATE: TipoCambio = { fecha: '2025-06-15', compra: 3.70, venta: 3.74, fuente: 'test' };

describe('toPEN', () => {
  it('PEN → PEN sin cambio', () => {
    expect(toPEN(100, 'PEN', RATE)).toBe(100);
  });

  it('USD → PEN usa tasa venta', () => {
    expect(toPEN(10, 'USD', RATE)).toBe(37.4);
  });

  it('moneda desconocida → sin cambio', () => {
    expect(toPEN(100, 'EUR', RATE)).toBe(100);
  });

  it('maneja montos con decimales', () => {
    expect(toPEN(1.5, 'USD', RATE)).toBeCloseTo(5.61, 2);
  });

  it('monto 0 → 0', () => {
    expect(toPEN(0, 'USD', RATE)).toBe(0);
  });
});

describe('toUSD', () => {
  it('USD → USD sin cambio', () => {
    expect(toUSD(100, 'USD', RATE)).toBe(100);
  });

  it('PEN → USD usa tasa compra', () => {
    expect(toUSD(370, 'PEN', RATE)).toBeCloseTo(100, 1);
  });

  it('moneda desconocida → sin cambio', () => {
    expect(toUSD(100, 'EUR', RATE)).toBe(100);
  });
});

describe('FALLBACK_RATE', () => {
  it('tiene compra y venta en rango PEN válido (3.0 – 4.5)', () => {
    expect(FALLBACK_RATE.compra).toBeGreaterThan(3.0);
    expect(FALLBACK_RATE.compra).toBeLessThan(4.5);
    expect(FALLBACK_RATE.venta).toBeGreaterThan(FALLBACK_RATE.compra);
    expect(FALLBACK_RATE.venta).toBeLessThan(4.5);
  });

  it('venta >= compra', () => {
    expect(FALLBACK_RATE.venta).toBeGreaterThanOrEqual(FALLBACK_RATE.compra);
  });

  it('fuente = "fallback"', () => {
    expect(FALLBACK_RATE.fuente).toBe('fallback');
  });
});

describe('consistencia toPEN / toUSD', () => {
  it('round-trip PEN→USD→PEN es aproximado (spread bancario < 2%)', () => {
    const original = 100;
    const inUsd = toUSD(original, 'PEN', RATE);
    const backToPen = toPEN(inUsd, 'USD', RATE);
    // El spread compra/venta genera una pérdida, pero < 2%
    expect(backToPen).toBeGreaterThan(original * 0.98);
    expect(backToPen).toBeLessThanOrEqual(original * 1.02);
  });
});
