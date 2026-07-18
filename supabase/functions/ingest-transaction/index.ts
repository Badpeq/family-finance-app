/**
 * Supabase Edge Function: ingest-transaction
 * Endpoint de ingesta automática de gastos desde correos bancarios y notificaciones push.
 *
 * Flujo:
 *   Make/n8n/MacroDroid → POST /ingest-transaction → esta función:
 *     1. Hashea el Bearer token (SHA-256) y valida contra ingest_tokens.token_hash
 *     2. Verifica que el token esté activo y no expirado
 *     3. Parsea el texto con Claude Haiku → { monto, moneda, comercio, ultimos_4 }
 *     4. Busca la tarjeta de crédito/débito por ultimos_4_digitos (si aplica)
 *     5. Inserta en transacciones con estado='PENDIENTE_REVISION'
 *     6. Si algo falla: guarda en log_errores_ingesta (no se pierde nada)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parseTransactionText } from './parseText.ts';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface IngestPayload {
  source:   'email' | 'notification';
  raw_text: string;
}

async function sha256hex(text: string): Promise<string> {
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method Not Allowed' }, 405);
  }

  // ── 1. Extraer Bearer y calcular hash ───────────────────────────────────
  const authHeader = req.headers.get('authorization') ?? '';
  const raw        = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!raw) return json({ error: 'Missing Authorization header' }, 401);

  const tokenHash = await sha256hex(raw);

  // ── 2. Leer y validar el body ────────────────────────────────────────────
  let payload: IngestPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { source, raw_text } = payload;

  if (!source || !['email', 'notification'].includes(source)) {
    return json({ error: "Campo 'source' debe ser 'email' o 'notification'" }, 400);
  }

  if (!raw_text || typeof raw_text !== 'string' || raw_text.trim().length < 5) {
    return json({ error: "Campo 'raw_text' requerido (mínimo 5 caracteres)" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // ── 3. Lookup por token_hash → user_id ──────────────────────────────────
  const { data: tokenRow, error: tokenErr } = await supabase
    .from('ingest_tokens')
    .select('user_id, activo, expira_en')
    .eq('token_hash', tokenHash)
    .single();

  if (tokenErr || !tokenRow) {
    await logError(supabase, tokenHash, source, raw_text, 'AUTH_FAILED', 'Token no encontrado', null);
    return json({ error: 'Unauthorized' }, 401);
  }

  if (!tokenRow.activo) {
    await logError(supabase, tokenHash, source, raw_text, 'AUTH_FAILED', 'Token revocado', null);
    return json({ error: 'Unauthorized' }, 401);
  }

  if (tokenRow.expira_en && new Date(tokenRow.expira_en) < new Date()) {
    await logError(supabase, tokenHash, source, raw_text, 'AUTH_FAILED', 'Token expirado', null);
    return json({ error: 'Unauthorized' }, 401);
  }

  const userId = tokenRow.user_id as string;

  // Actualizar ultimo_uso sin esperar
  supabase
    .from('ingest_tokens')
    .update({ ultimo_uso: new Date().toISOString() })
    .eq('token_hash', tokenHash)
    .then(() => {});

  // ── 4. Parsear texto con Claude Haiku ────────────────────────────────────
  let parsed: Awaited<ReturnType<typeof parseTransactionText>>;
  try {
    parsed = await parseTransactionText(raw_text.trim());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Error llamando a Anthropic:', msg);
    await logError(supabase, tokenHash, source, raw_text, 'PARSE_FAILED', msg, null);
    return json({ ok: false, error: 'Error de parsing — guardado en log', logged: true }, 200);
  }

  if (!parsed) {
    await logError(supabase, tokenHash, source, raw_text, 'NO_MONTO', 'IA no pudo extraer monto válido', null);
    return json({ ok: false, error: 'No se pudo identificar el monto — guardado en log', logged: true }, 200);
  }

  // ── 5. Matching de tarjeta por ultimos_4_digitos ─────────────────────────
  let tarjetaId: string | null = null;

  if (parsed.ultimos_4_digitos) {
    const { data: tarjeta } = await supabase
      .from('tarjetas_credito')
      .select('id')
      .eq('user_id', userId)
      .eq('ultimos_4', parsed.ultimos_4_digitos)
      .eq('activo', true)
      .limit(1)
      .single();

    tarjetaId = tarjeta?.id ?? null;

    if (!tarjetaId) {
      console.warn(`No se encontró tarjeta con *${parsed.ultimos_4_digitos} para user ${userId} — tx sin tarjeta_id`);
    }
  }

  // ── 6. Insertar transacción con estado PENDIENTE_REVISION ────────────────
  const { data: tx, error: insertErr } = await supabase
    .from('transacciones')
    .insert({
      user_id:        userId,
      tipo:           'gasto',
      monto:          parsed.monto,
      moneda:         parsed.moneda,
      tipo_cambio:    parsed.moneda === 'USD' ? null : 1.0,
      categoria:      'Por clasificar',
      descripcion:    parsed.comercio,
      fecha:          new Date().toISOString().split('T')[0],
      metodo_pago:    tarjetaId ? 'tarjeta' : 'efectivo',
      tarjeta_id:     tarjetaId,
      fuente:         `auto_${source}`,
      fuente_raw:     raw_text.trim(),
      es_gasto_unico: true,
      estado:         'PENDIENTE_REVISION',
      activo:         true,
    })
    .select('id')
    .single();

  if (insertErr) {
    console.error('Error insertando transacción:', insertErr);
    await logError(supabase, tokenHash, source, raw_text, 'INSERT_FAILED', insertErr.message, parsed as unknown as Record<string, unknown>);
    return json({ ok: false, error: 'Error al guardar — guardado en log', logged: true }, 200);
  }

  console.log(`Tx ingresada: id=${tx!.id} user=${userId} monto=${parsed.monto} comercio=${parsed.comercio}`);

  return json({
    ok:         true,
    id:         tx!.id,
    monto:      parsed.monto,
    moneda:     parsed.moneda,
    comercio:   parsed.comercio,
    tarjeta_id: tarjetaId,
    estado:     'PENDIENTE_REVISION',
  }, 200);
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function logError(
  supabase:       ReturnType<typeof createClient>,
  token:          string | null,
  source:         string,
  raw_text:       string,
  error_tipo:     string,
  error_msg:      string,
  parsed_partial: Record<string, unknown> | null,
): Promise<void> {
  const { error } = await supabase
    .from('log_errores_ingesta')
    .insert({ token, source, raw_text, error_tipo, error_msg, parsed_partial });

  if (error) {
    console.error('No se pudo guardar en log_errores_ingesta:', error.message);
  }
}
