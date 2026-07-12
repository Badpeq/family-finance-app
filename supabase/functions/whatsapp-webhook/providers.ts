/**
 * Adaptadores de proveedores WhatsApp.
 * Para cambiar de Meta → Wassenger: reemplaza las implementaciones de
 * parseWhatsAppPayload / downloadMedia / sendWhatsAppReply manteniendo
 * la misma interfaz IncomingMessage.
 */

const GRAPH_URL = 'https://graph.facebook.com/v19.0';
const WA_ACCESS_TOKEN    = Deno.env.get('WA_ACCESS_TOKEN')!;
const WA_PHONE_NUMBER_ID = Deno.env.get('WA_PHONE_NUMBER_ID')!;

export interface IncomingMessage {
  from:     string;   // E.164 sin '+': '51987654321'
  type:     'image' | 'text' | 'other';
  mediaId?: string;   // presente si type === 'image'
  text?:    string;
}

export interface MediaDownload {
  base64:   string;
  mimeType: string;
}

// ── Meta Cloud API ────────────────────────────────────────────────────────

/**
 * Parsea el payload JSON de Meta WhatsApp Cloud API.
 * Devuelve null si el mensaje no es relevante (status updates, etc.).
 */
export function parseWhatsAppPayload(body: Record<string, unknown>): IncomingMessage | null {
  try {
    const entry   = (body?.entry   as any[])?.[0];
    const change  = (entry?.changes as any[])?.[0];
    const message = (change?.value?.messages as any[])?.[0];
    if (!message) return null;

    const type: IncomingMessage['type'] =
      message.type === 'image' ? 'image'
      : message.type === 'text' ? 'text'
      : 'other';

    return {
      from:    String(message.from),
      type,
      mediaId: message.image?.id,
      text:    message.text?.body,
    };
  } catch {
    return null;
  }
}

/**
 * Descarga un archivo multimedia de Meta en dos pasos:
 * 1. Resuelve la URL real desde el Graph API con el media_id
 * 2. Descarga los bytes y los devuelve en base64
 */
export async function downloadMedia(mediaId: string): Promise<MediaDownload> {
  // Paso 1: obtener URL real del recurso
  const metaRes = await fetch(`${GRAPH_URL}/${mediaId}`, {
    headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}` },
  });
  if (!metaRes.ok) throw new Error(`Meta media resolve failed: ${metaRes.status}`);
  const { url, mime_type } = await metaRes.json();

  // Paso 2: descargar bytes de la imagen
  const imgRes = await fetch(url, {
    headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}` },
  });
  if (!imgRes.ok) throw new Error(`Media download failed: ${imgRes.status}`);

  const buffer   = await imgRes.arrayBuffer();
  const mimeType = (imgRes.headers.get('content-type') ?? mime_type ?? 'image/jpeg').split(';')[0];

  return { base64: arrayBufferToBase64(buffer), mimeType };
}

/**
 * Envía un mensaje de texto de vuelta al usuario por WhatsApp.
 */
export async function sendWhatsAppReply(to: string, text: string): Promise<void> {
  const res = await fetch(`${GRAPH_URL}/${WA_PHONE_NUMBER_ID}/messages`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${WA_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }),
  });
  if (!res.ok) console.error('sendWhatsAppReply failed:', await res.text());
}

// ── Utilidades ────────────────────────────────────────────────────────────

/** Convierte ArrayBuffer → base64 de forma segura para buffers grandes. */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes     = new Uint8Array(buffer);
  const chunkSize = 8192;
  let binary      = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Valida la firma HMAC-SHA256 que Meta incluye en X-Hub-Signature-256.
 * Rechaza el request si el cuerpo fue alterado en tránsito.
 */
export async function validateMetaSignature(
  req:       Request,
  rawBody:   string,
  appSecret: string,
): Promise<boolean> {
  const signature = req.headers.get('x-hub-signature-256') ?? '';
  if (!signature.startsWith('sha256=')) return false;
  const expectedHex = signature.slice(7);

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf  = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const computed = Array.from(new Uint8Array(sigBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return expectedHex === computed;
}
