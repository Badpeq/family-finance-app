/**
 * M8-Lib · importStore
 * Cubre: set, getText, getAutoparse, getMode, clear
 */

import { importStore } from '@/lib/importStore';

describe('importStore', () => {
  afterEach(() => importStore.clear());

  it('inicia vacío', () => {
    expect(importStore.getText()).toBe('');
    expect(importStore.getAutoparse()).toBe(false);
    expect(importStore.getMode()).toBe('ticket');
  });

  it('almacena texto, autoparse=false y mode=ticket por defecto', () => {
    importStore.set('texto OCR');
    expect(importStore.getText()).toBe('texto OCR');
    expect(importStore.getAutoparse()).toBe(false);
    expect(importStore.getMode()).toBe('ticket');
  });

  it('almacena autoparse=true', () => {
    importStore.set('texto', true);
    expect(importStore.getAutoparse()).toBe(true);
  });

  it('almacena mode=voucher', () => {
    importStore.set('texto', false, 'voucher');
    expect(importStore.getMode()).toBe('voucher');
  });

  it('clear() resetea todos los campos', () => {
    importStore.set('texto', true, 'voucher');
    importStore.clear();
    expect(importStore.getText()).toBe('');
    expect(importStore.getAutoparse()).toBe(false);
    expect(importStore.getMode()).toBe('ticket');
  });

  it('sobreescribe valor anterior', () => {
    importStore.set('primero', false, 'voucher');
    importStore.set('segundo', true, 'ticket');
    expect(importStore.getText()).toBe('segundo');
    expect(importStore.getMode()).toBe('ticket');
  });

  it('preserva texto con saltos de línea y caracteres especiales', () => {
    const multiline = 'Línea 1\nLínea 2\nS/. 25.50';
    importStore.set(multiline);
    expect(importStore.getText()).toBe(multiline);
  });
});
