/**
 * Supabase Edge Function: ingest-transaction
 * Endpoint de ingesta automática de gastos desde correos bancarios y notificaciones push.
 *
 * Semántica de respuestas (paso 1.6):
 *   401 — AUTH_FAILED (token no encontrado, revocado o expirado)
 *   429 — Rate limit excedido (sin llamar a Claude)
 *   400 — Body inválido (JSON malformado, campos faltantes)
 *   200 { ok:true }  — Transacción ingresada
 *   200 { ok:true,  duplicado:true } — Correo ya procesado (dedup por ingest_hash)
 *   200 { ok:false, logged:true }   — Error de parsing — guardado en log
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
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method Not Allowed' }, 405);
  }

  // ── 1. Auth PRIMERO — antes de leer el body ──────────────────────────────
  const authHeader = req.headers.get('authorization') ?? '';
  const raw        = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!raw) return json({ error: 'Unauthorized' }, 401);

  const tokenHash = await sha256hex(raw);
  const supabase  = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: tokenRow } = await supabase
    .from('ingest_tokens')
    .select('user_id, activo, expira_en')
    .eq('token_hash', tokenHash)
    .single();

  if (!tokenRow?.activo) return json({ error: 'Unauthorized' }, 401);
  if (tokenRow.expira_en && new Date(tokenRow.expira_en) < new Date()) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const userId = tokenRow.user_id as string;

  // ── 2. Rate limiting — antes de leer el body ────────────────────────────
  const { data: allowed } = await supabase.rpc('fn_check_rate_limit', {
    p_clave:   `ingest:${tokenHash}`,
    p_max:     30,
    p_ventana: '1 hour',
  });
  if (!allowed) return json({ error: 'Too Many Requests' }, 429);

  // Actualizar ultimo_uso (fire & forget — no bloquea el flujo)
  supabase
    .from('ingest_tokens')
    .update({ ultimo_uso: new Date().toISOString() })
    .eq('token_hash', tokenHash)
    .then(() => {});

  // ── 3. Leer y validar body (solo si el caller es legítimo) ───────────────
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

  // ── 4. Parsear texto con Claude Haiku ────────────────────────────────────
  // Errores de parsing → 200 para que Make/n8n no reintente (no es un error recuperable)
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
  }

  // ── 6. Insertar transacción ───────────────────────────────────────────────
  const normalizedText = raw_text.trim().toLowerCase().replace(/\s+/g, ' ');
  const ingestHash     = await sha256hex(userId + normalizedText);

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
      ingest_hash:    ingestHash,
    })
    .select('id')
    .single();

  if (insertErr) {
    if ((insertErr as { code?: string }).code === '23505') {
      return json({ ok: true, duplicado: true }, 200);
    }
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

  if (error) console.error('No se pudo guardar en log_errores_ingesta:', error.message);
}
