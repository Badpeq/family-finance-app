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
import { tryParseWithRegex } from './parseRegex.ts';
import { captureException } from '../_shared/sentry.ts';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EXPO_PUSH_URL        = 'https://exp.host/--/api/v2/push/send';
const CONFIANZA_THRESHOLD  = 0.90;
const IA_MAX_MENSUAL       = 300;

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

  // ── 4. Intentar regex primero (cero costo de IA) ─────────────────────────
  let parsed = tryParseWithRegex(raw_text.trim());
  let usedRegex = parsed !== null;

  if (!parsed) {
    // ── 4b. Verificar tope mensual de IA ───────────────────────────────────
    const añoMes = new Date().toISOString().slice(0, 7);
    const { data: iaAllowed } = await supabase.rpc('fn_check_ia_limit', {
      p_user_id: userId,
      p_año_mes: añoMes,
      p_max:     IA_MAX_MENSUAL,
    });

    if (!iaAllowed) {
      console.warn(`IA limit reached for user ${userId} in ${añoMes}`);
      // Insertar sin categoría sugerida (no perder el gasto)
      const normalizedText = raw_text.trim().toLowerCase().replace(/\s+/g, ' ');
      const ingestHash     = await sha256hex(userId + normalizedText);
      const { error: insertErr } = await supabase.from('transacciones').insert({
        user_id: userId, tipo: 'gasto', monto: 0, moneda: 'PEN', tipo_cambio: 1.0,
        categoria: 'Por clasificar', descripcion: 'Gasto (límite IA alcanzado)',
        fecha: new Date().toISOString().split('T')[0], metodo_pago: 'efectivo',
        fuente: `auto_${source}`, fuente_raw: raw_text.trim(), es_gasto_unico: true,
        estado: 'PENDIENTE_REVISION', activo: true, ingest_hash: ingestHash,
      });
      if (insertErr && (insertErr as { code?: string }).code === '23505') {
        return json({ ok: true, duplicado: true }, 200);
      }
      return json({ ok: true, estado: 'PENDIENTE_REVISION', ia_limit: true }, 200);
    }

    // ── 4c. Cargar categorías y llamar a Claude ─────────────────────────────
    const { data: catRows } = await supabase
      .from('v_categorias')
      .select('nombre')
      .neq('nombre', 'Por clasificar');
    const categorias = (catRows ?? []).map((r: { nombre: string }) => r.nombre);

    try {
      parsed = await parseTransactionText(raw_text.trim(), categorias);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Error llamando a Anthropic:', msg);
      captureException(err, { source, userId });
      await logError(supabase, tokenHash, source, raw_text, 'PARSE_FAILED', msg, null);
      return json({ ok: false, error: 'Error de parsing — guardado en log', logged: true }, 200);
    }

    if (!parsed) {
      await logError(supabase, tokenHash, source, raw_text, 'NO_MONTO', 'IA no pudo extraer monto válido', null);
      return json({ ok: false, error: 'No se pudo identificar el monto — guardado en log', logged: true }, 200);
    }
  }

  console.log(`Parse: ${usedRegex ? 'regex' : 'claude'} comercio=${parsed.comercio} monto=${parsed.monto}`);

  // ── 6. Lookup de regla de categorización ─────────────────────────────────
  const comercioNorm = normalizar(parsed.comercio);
  const { data: regla } = await supabase
    .from('reglas_categorizacion')
    .select('id, categoria, veces_aplicada')
    .eq('user_id', userId)
    .eq('comercio_normalizado', comercioNorm)
    .maybeSingle();

  // Cadena de decisión: regla > Claude ≥0.90 > PENDIENTE
  let categoriaFinal:  string;
  let autoClasificado: boolean;
  let estadoFinal:     string;
  let categoriaSug:    string | null = null;

  if (regla) {
    categoriaFinal  = regla.categoria;
    autoClasificado = true;
    estadoFinal     = 'PROCESADO';
    // Incrementar contador de usos (fire & forget)
    supabase.from('reglas_categorizacion')
      .update({ veces_aplicada: (regla as { veces_aplicada: number }).veces_aplicada + 1 })
      .eq('id', regla.id)
      .then(() => {});
  } else if (parsed.confianza != null && parsed.confianza >= CONFIANZA_THRESHOLD && parsed.categoria_sugerida) {
    categoriaFinal  = parsed.categoria_sugerida;
    autoClasificado = true;
    estadoFinal     = 'PROCESADO';
  } else {
    categoriaFinal  = 'Por clasificar';
    autoClasificado = false;
    estadoFinal     = 'PENDIENTE_REVISION';
    categoriaSug    = parsed.categoria_sugerida;
  }

  // ── 7. Matching de tarjeta por ultimos_4_digitos ─────────────────────────
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

  // ── 8. Insertar transacción ───────────────────────────────────────────────
  const normalizedText = raw_text.trim().toLowerCase().replace(/\s+/g, ' ');
  const ingestHash     = await sha256hex(userId + normalizedText);

  const { data: tx, error: insertErr } = await supabase
    .from('transacciones')
    .insert({
      user_id:            userId,
      tipo:               'gasto',
      monto:              parsed.monto,
      moneda:             parsed.moneda,
      tipo_cambio:        parsed.moneda === 'USD' ? null : 1.0,
      categoria:          categoriaFinal,
      categoria_sugerida: categoriaSug,
      confianza_ia:       parsed.confianza,
      auto_clasificado:   autoClasificado,
      descripcion:        parsed.comercio,
      fecha:              new Date().toISOString().split('T')[0],
      metodo_pago:        tarjetaId ? 'tarjeta' : 'efectivo',
      tarjeta_id:         tarjetaId,
      fuente:             `auto_${source}`,
      fuente_raw:         raw_text.trim(),
      es_gasto_unico:     true,
      estado:             estadoFinal,
      activo:             true,
      ingest_hash:        ingestHash,
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

  console.log(`Tx ingresada: id=${tx!.id} user=${userId} monto=${parsed.monto} comercio=${parsed.comercio} estado=${estadoFinal}`);

  // ── 9. Push si queda PENDIENTE_REVISION ──────────────────────────────────
  if (estadoFinal === 'PENDIENTE_REVISION') {
    sendPushPendiente(supabase, userId, parsed.monto, parsed.moneda, parsed.comercio, categoriaSug);
  }

  return json({
    ok:               true,
    id:               tx!.id,
    monto:            parsed.monto,
    moneda:           parsed.moneda,
    comercio:         parsed.comercio,
    tarjeta_id:       tarjetaId,
    estado:           estadoFinal,
    auto_clasificado: autoClasificado,
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

/** Normaliza un nombre de comercio: minúsculas, sin tildes, sin espacios extras. */
function normalizar(s: string): string {
  return s.trim().toLowerCase()
    .normalize('NFD').replace(/\p{Mn}/gu, '')
    .replace(/\s+/g, ' ');
}

/** Envía push a Expo si el usuario tiene token registrado. Fire & forget. */
async function sendPushPendiente(
  supabase:   ReturnType<typeof createClient>,
  userId:     string,
  monto:      number,
  moneda:     string,
  comercio:   string,
  categoriaSug: string | null,
): Promise<void> {
  const { data: prof } = await supabase
    .from('profiles')
    .select('expo_push_token')
    .eq('id', userId)
    .single();

  const token = (prof as { expo_push_token?: string } | null)?.expo_push_token;
  if (!token?.startsWith('ExponentPushToken[')) return;

  const sym  = moneda === 'USD' ? '$' : 'S/';
  const body = categoriaSug
    ? `${sym} ${monto.toFixed(2)} · ${comercio} — sugerido: ${categoriaSug}`
    : `${sym} ${monto.toFixed(2)} · ${comercio}`;

  await fetch(EXPO_PUSH_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      to:           token,
      title:        'Gasto pendiente de revisión',
      body,
      categoryId:   'pendiente',
      data:         { tipo: 'pendiente' },
    }),
  }).catch(err => console.warn('Push send failed:', err));
}
