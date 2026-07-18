/**
 * Motor de parsing de texto para correos bancarios y notificaciones push.
 * Usa Claude Haiku para extracción estructurada de datos de gasto.
 *
 * Soporta formatos de los bancos peruanos principales:
 *   BCP, BBVA, Interbank, Scotiabank, BanBif, Mibanco, Yape, Plin
 */

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const MODEL             = 'claude-haiku-4-5-20251001';
const MAX_TOKENS        = 300;

export interface ParsedTransaction {
  monto:              number;
  moneda:             'PEN' | 'USD';
  comercio:           string;
  ultimos_4_digitos:  string | null;
  tipo:               'gasto';
  categoria_sugerida: string | null;
  confianza:          number | null;
}

const SYSTEM_PROMPT = `Eres un extractor de datos financieros para una app de finanzas personales peruana.
Analizas textos de correos bancarios y notificaciones push de bancos peruanos (BCP, BBVA, Interbank, Scotiabank, BanBif, Mibanco).
Responde ÚNICAMENTE con un objeto JSON válido, sin markdown, sin explicaciones adicionales.
Si un campo no está presente en el texto, usa null.`;

function buildUserPrompt(rawText: string, categorias: string[]): string {
  const hoy   = new Date().toISOString().split('T')[0];
  const catList = categorias.length > 0 ? categorias.join(', ') : 'Alimentación, Transporte, Servicios, Otros';
  return `Extrae los datos de gasto del siguiente texto y devuelve exactamente este JSON:
{
  "monto": <número decimal sin símbolo de moneda, ejemplo: 45.50>,
  "moneda": "<'PEN' si es soles (S/, S/., PEN) o 'USD' si es dólares ($, USD)>",
  "comercio": "<nombre del establecimiento o destinatario donde se realizó el gasto>",
  "ultimos_4_digitos": "<últimos 4 dígitos de la tarjeta si aparecen como *1234 o (1234), o null si no se mencionan>",
  "tipo": "gasto",
  "categoria": "<una de: ${catList}>",
  "confianza": <número 0-1 de qué tan seguro estás de la categoría>
}

Fecha de hoy para referencia: ${hoy}

TEXTO A ANALIZAR:
${rawText}`;
}

/**
 * Envía el texto a Claude Haiku y devuelve los datos estructurados del gasto.
 * Retorna null si no se puede identificar un gasto válido.
 */
export async function parseTransactionText(
  rawText:   string,
  categorias: string[] = [],
): Promise<ParsedTransaction | null> {
  rawText = rawText.slice(0, 4000);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: MAX_TOKENS,
      system:     SYSTEM_PROMPT,
      messages: [{
        role:    'user',
        content: buildUserPrompt(rawText, categorias),
      }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }

  const json    = await res.json();
  const rawResp = (json.content?.[0]?.text ?? '') as string;

  const parsed = safeParseJson(rawResp);
  if (!parsed) {
    console.warn('parseText: Claude devolvió respuesta no-JSON:', rawResp.slice(0, 200));
    return null;
  }

  const monto = parseFloat(String(parsed.monto ?? ''));
  if (!Number.isFinite(monto) || monto <= 0 || monto > 500_000) {
    console.warn('parseText: monto inválido:', parsed.monto);
    return null;
  }

  if (!['PEN', 'USD'].includes(String(parsed.moneda ?? '').toUpperCase())) {
    parsed.moneda = 'PEN';
  }
  const moneda = String(parsed.moneda).toUpperCase();

  const confianza = parsed.confianza != null ? Math.min(1, Math.max(0, Number(parsed.confianza))) : null;

  return {
    monto,
    moneda:             (moneda === 'USD' ? 'USD' : 'PEN') as 'PEN' | 'USD',
    comercio:           String(parsed.comercio ?? 'Sin nombre').slice(0, 120).trim(),
    ultimos_4_digitos:  extractDigits(parsed.ultimos_4_digitos),
    tipo:               'gasto',
    categoria_sugerida: parsed.categoria ? String(parsed.categoria).slice(0, 80) : null,
    confianza:          Number.isFinite(confianza) ? confianza : null,
  };
}

// ── Utilidades ──────────────────────────────────────────────────────────────

function safeParseJson(text: string): Record<string, unknown> | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

/** Extrae exactamente 4 dígitos numéricos de un valor, o devuelve null. */
function extractDigits(val: unknown): string | null {
  if (!val || val === 'null') return null;
  const digits = String(val).replace(/\D/g, '');
  return digits.length === 4 ? digits : null;
}
