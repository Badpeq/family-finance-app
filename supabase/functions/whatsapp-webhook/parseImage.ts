/**
 * Motor de visión para comprobantes Yape y Plin.
 * Usa Claude claude-haiku-4-5-20251001 (multimodal) para extracción estructurada JSON.
 * Haiku: rápido, económico (~$0.0006 por imagen), preciso en textos estructurados.
 */

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const MODEL             = 'claude-haiku-4-5-20251001';
const MAX_TOKENS        = 300;

export interface YapePlinExtracted {
  monto:               number;
  comercio_o_persona:  string;
  fecha:               string;   // YYYY-MM-DD
  moneda:              'PEN';
  operacion_id:        string;
  app_origen:          'yape' | 'plin' | 'desconocido';
  raw_text:            string;
}

const SYSTEM_PROMPT = `Eres un extractor de datos de comprobantes de pago digitales peruanos.
Analizas capturas de pantalla de Yape y Plin.
Responde ÚNICAMENTE con un objeto JSON válido, sin markdown, sin explicaciones.
Si un campo no está visible en la imagen, usa null.`;

function buildUserPrompt(): string {
  const hoy = new Date().toISOString().split('T')[0];
  return `Extrae los datos de este comprobante y devuelve exactamente este JSON:
{
  "monto": <número decimal, ejemplo: 45.50>,
  "comercio_o_persona": "<nombre exacto del destinatario como aparece en la captura>",
  "fecha": "<fecha en formato YYYY-MM-DD. Si dice 'hoy' o 'ahora' usa ${hoy}. Si no hay fecha usa ${hoy}>",
  "moneda": "PEN",
  "operacion_id": "<código de operación, número de transacción o ID único tal como aparece>",
  "app_origen": "<'yape' si es Yape, 'plin' si es Plin, 'desconocido' si no se puede determinar>"
}`;
}

/**
 * Envía la imagen a Claude claude-haiku-4-5-20251001 y extrae los campos del comprobante.
 * Retorna null si la imagen no es un comprobante válido o si faltan campos obligatorios.
 */
export async function extractYapePlinData(
  base64:   string,
  mimeType: string = 'image/jpeg',
): Promise<YapePlinExtracted | null> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':    'application/json',
      'x-api-key':       ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: MAX_TOKENS,
      system:     SYSTEM_PROMPT,
      messages: [{
        role:    'user',
        content: [
          {
            type:   'image',
            source: { type: 'base64', media_type: mimeType, data: base64 },
          },
          {
            type: 'text',
            text: buildUserPrompt(),
          },
        ],
      }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }

  const json     = await res.json();
  const rawText  = (json.content?.[0]?.text ?? '') as string;

  const parsed = safeParseJson(rawText);
  if (!parsed) {
    console.warn('parseImage: Claude returned non-JSON:', rawText);
    return null;
  }

  // Validar campos obligatorios
  if (!parsed.monto || !parsed.operacion_id) {
    console.warn('parseImage: missing required fields', parsed);
    return null;
  }

  const monto = parseFloat(String(parsed.monto));
  if (!Number.isFinite(monto) || monto <= 0 || monto > 500_000) {
    console.warn('parseImage: monto inválido:', parsed.monto);
    return null;
  }

  const hoy = new Date().toISOString().split('T')[0];

  return {
    monto,
    comercio_o_persona: String(parsed.comercio_o_persona ?? 'Sin nombre').slice(0, 120),
    fecha:              isValidDate(parsed.fecha) ? String(parsed.fecha) : hoy,
    moneda:             'PEN',
    operacion_id:       String(parsed.operacion_id).trim(),
    app_origen:         (['yape','plin'].includes(parsed.app_origen) ? parsed.app_origen : 'desconocido') as YapePlinExtracted['app_origen'],
    raw_text:           rawText,
  };
}

// ── Utilidades ─────────────────────────────────────────────────────────────

/** Extrae y parsea el primer objeto JSON encontrado en un string. */
function safeParseJson(text: string): Record<string, unknown> | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function isValidDate(val: unknown): boolean {
  if (typeof val !== 'string') return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(val) && !isNaN(Date.parse(val));
}
