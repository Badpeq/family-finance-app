/**
 * M8 · OCR endpoint — smoke test de integración
 *
 * Envía un ticket real al endpoint Vercel y verifica que:
 *   - responde HTTP 200
 *   - devuelve texto no vacío
 *   - el texto contiene palabras clave del ticket (RUC, TOTAL)
 *
 * REQUIERE red. Se salta en entorno CI sin `INTEGRATION=1`.
 */

import * as fs from 'fs';
import * as path from 'path';

const OCR_ENDPOINT = 'https://family-finance-app-ruby.vercel.app/api/ocr';
const TICKET_PATH  = path.join(__dirname, '../docs/ticket1.jpeg');
const RUN_INTEGRATION = process.env.INTEGRATION === '1';

const describeOrSkip = RUN_INTEGRATION ? describe : describe.skip;

describeOrSkip('OCR endpoint (integración)', () => {
  jest.setTimeout(30_000);

  it('responde 200 y devuelve texto del ticket', async () => {
    const buf    = fs.readFileSync(TICKET_PATH);
    const base64 = buf.toString('base64');

    const res = await fetch(OCR_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64 }),
    });

    expect(res.ok).toBe(true);
    const { text } = (await res.json()) as { text: string };
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(50);
    expect(text.toUpperCase()).toContain('RUC');
    expect(text.toUpperCase()).toContain('TOTAL');
  });

  it('extrae productos que suman el total del ticket (S/ 191.40)', async () => {
    const { parseTicketItems } = await import('@/lib/parseVoucher');

    const buf    = fs.readFileSync(TICKET_PATH);
    const base64 = buf.toString('base64');

    const res  = await fetch(OCR_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: base64 }) });
    const { text } = (await res.json()) as { text: string };

    const items = parseTicketItems(text);
    const total = items.reduce((s, i) => s + i.precio_total, 0);

    expect(items.length).toBeGreaterThanOrEqual(10);
    expect(total).toBeCloseTo(191.4, 0);
  });

  it('devuelve error informativo si falta el campo image', async () => {
    const res = await fetch(OCR_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/missing image/i);
  });

  it('rechaza método GET con 405', async () => {
    const res = await fetch(OCR_ENDPOINT, { method: 'GET' });
    expect(res.status).toBe(405);
  });
});
