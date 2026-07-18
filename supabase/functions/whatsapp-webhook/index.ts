/**
 * Supabase Edge Function: whatsapp-webhook
 * Punto de entrada para mensajes entrantes de WhatsApp (Meta Cloud API).
 *
 * Flujo:
 *   WhatsApp user → comparte captura Yape/Plin → número WA Business
 *   Meta → POST /whatsapp-webhook → esta función:
 *     1. Valida firma HMAC-SHA256 (Meta App Secret)
 *     2. Descarga la imagen del comprobante
 *     3. Extrae monto/destino/fecha via Claude claude-haiku-4-5-20251001 visión
 *     4. Identifica al usuario por su número WhatsApp (profiles.telefono_whatsapp)
 *     5. Inserta en transacciones (idempotente via operacion_id)
 *     6. Responde al usuario confirmando el registro
 *
 * Deploy:
 *   supabase functions deploy whatsapp-webhook --no-verify-jwt
 *
 * Variables de entorno requeridas (Supabase Dashboard → Edge Functions → Secrets):
 *   WA_VERIFY_TOKEN       Token que tú defines para la verificación inicial de Meta
 *   WA_ACCESS_TOKEN       Token permanente de Meta WhatsApp Business API
 *   WA_PHONE_NUMBER_ID    ID del número de teléfono registrado en Meta
 *   WA_APP_SECRET         App Secret de tu Meta App (para validar firmas)
 *   ANTHROPIC_API_KEY     API key de Anthropic para visión con Claude claude-haiku-4-5-20251001
 *   SUPABASE_URL          URL del proyecto (disponible automáticamente en Edge Functions)
 *   SUPABASE_SERVICE_ROLE_KEY  Service role key para bypass de RLS en inserciones del servidor
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  parseWhatsAppPayload,
  downloadMedia,
  sendWhatsAppReply,
  validateMetaSignature,
} from './providers.ts';
import { extractYapePlinData } from './parseImage.ts';
import { parseTransactionText } from '../ingest-transaction/parseText.ts';
import { captureException } from '../_shared/sentry.ts';

const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WA_VERIFY_TOKEN       = Deno.env.get('WA_VERIFY_TOKEN')!;
const WA_APP_SECRET         = Deno.env.get('WA_APP_SECRET')!;

Deno.serve(async (req: Request) => {
  // ── GET: verificación inicial del webhook (Meta lo llama una sola vez) ──
  if (req.method === 'GET') {
    const url       = new URL(req.url);
    const mode      = url.searchParams.get('hub.mode');
    const token     = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === WA_VERIFY_TOKEN && challenge) {
      console.log('Webhook verificado por Meta.');
      return new Response(challenge, { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }

  // ── POST: mensaje entrante ───────────────────────────────────────────────
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  // 1. Validar firma — rechaza cualquier petición que no venga de Meta
  const valid = await validateMetaSignature(req, rawBody, WA_APP_SECRET);
  if (!valid) {
    console.warn('Firma inválida — petición rechazada.');
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  // 2. Parsear el mensaje de WhatsApp
  const msg = parseWhatsAppPayload(payload);
  if (!msg) {
    // Puede ser un status update u otro tipo de notificación de Meta — ignorar silenciosamente
    return new Response('OK', { status: 200 });
  }

  // 3. Buscar usuario por número WhatsApp
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('id, nombre')
    .eq('telefono_whatsapp', msg.from)
    .single();

  if (profileErr || !profile) {
    console.warn(`Número no vinculado: ${msg.from}`);
    await sendWhatsAppReply(
      msg.from,
      '❌ Tu número no está vinculado a ninguna cuenta de Family Finance.\n\nAbre la app → Configuración → WhatsApp para vincularlo.',
    );
    return new Response('OK', { status: 200 });
  }

  // 3b. Dispatch por tipo de mensaje (después de verificar usuario)
  if (msg.type === 'text' && msg.text) {
    await handleTextMessage(supabase, msg.from, msg.text, profile);
    return new Response('OK', { status: 200 });
  }

  if (msg.type !== 'image' || !msg.mediaId) {
    await sendWhatsAppReply(
      msg.from,
      '👋 Envía la captura de pantalla de tu Yape o Plin, o escribe el monto y descripción (ej: "25 taxi").',
    );
    return new Response('OK', { status: 200 });
  }

  // 3c. Rate limiting — 60 req/hora por número WhatsApp
  // Meta requiere respuesta 200 para no reintentar, así que avisamos al usuario y salimos
  const { data: allowed } = await supabase.rpc('fn_check_rate_limit', {
    p_clave:   `wa:${msg.from}`,
    p_max:     60,
    p_ventana: '1 hour',
  });
  if (!allowed) {
    await sendWhatsAppReply(
      msg.from,
      '⏱️ Demasiados mensajes en poco tiempo. Espera unos minutos antes de enviar otro comprobante.',
    );
    return new Response('OK', { status: 200 });
  }

  // 4. Descargar imagen
  let media: Awaited<ReturnType<typeof downloadMedia>>;
  try {
    media = await downloadMedia(msg.mediaId);
  } catch (err) {
    console.error('Error descargando imagen:', err);
    await sendWhatsAppReply(msg.from, '⚠️ No pude descargar la imagen. Inténtalo de nuevo.');
    return new Response('OK', { status: 200 });
  }

  // 5. Extraer datos con Claude claude-haiku-4-5-20251001 visión
  let extracted: Awaited<ReturnType<typeof extractYapePlinData>>;
  try {
    extracted = await extractYapePlinData(media.base64, media.mimeType);
  } catch (err) {
    console.error('Error en extracción AI:', err);
    captureException(err, { from: msg.from });
    await sendWhatsAppReply(
      msg.from,
      '⚠️ Ocurrió un error procesando el comprobante. Intenta de nuevo o registra el gasto manualmente.',
    );
    return new Response('OK', { status: 200 });
  }

  if (!extracted) {
    await sendWhatsAppReply(
      msg.from,
      '🤔 No pude identificar un comprobante de Yape o Plin en la imagen.\n\nAsegúrate de enviar una captura de pantalla completa del pago.',
    );
    return new Response('OK', { status: 200 });
  }

  // 6. Insertar transacción (idempotente: ON CONFLICT DO NOTHING via índice único)
  const { error: insertErr } = await supabase
    .from('transacciones')
    .insert({
      user_id:             profile.id,
      tipo:                'gasto',
      monto:               extracted.monto,
      categoria:           'Por clasificar',   // el usuario lo clasifica desde la app
      descripcion:         extracted.comercio_o_persona,
      fecha:               extracted.fecha,
      moneda:              'PEN',
      tipo_cambio:         null,
      fuente:              `whatsapp_${extracted.app_origen}`,
      operacion_id:        extracted.operacion_id,
      fuente_raw:          extracted.raw_text,
      es_gasto_unico:      true,
      metodo_pago:         'transferencia',
    });

  // Código 23505 = unique violation (operacion_id duplicado → ya fue procesado)
  if (insertErr) {
    if ((insertErr as any).code === '23505') {
      await sendWhatsAppReply(
        msg.from,
        `⚠️ Este comprobante (op. ${extracted.operacion_id}) ya fue registrado anteriormente.`,
      );
      return new Response('OK', { status: 200 });
    }
    console.error('Error insertando transacción:', insertErr);
    await sendWhatsAppReply(
      msg.from,
      '❌ Error al guardar el gasto. Inténtalo de nuevo o regístralo manualmente.',
    );
    return new Response('OK', { status: 200 });
  }

  // 7. Confirmar al usuario
  const appLabel = extracted.app_origen === 'yape' ? 'Yape'
                 : extracted.app_origen === 'plin'  ? 'Plin'
                 : 'pago';

  await sendWhatsAppReply(
    msg.from,
    `✅ ${appLabel} registrado\n\n` +
    `💸 S/ ${extracted.monto.toFixed(2)} → ${extracted.comercio_o_persona}\n` +
    `📅 ${extracted.fecha}\n\n` +
    `Abre la app para asignarle una categoría.`,
  );

  console.log(`Tx insertada: user=${profile.id} monto=${extracted.monto} op=${extracted.operacion_id}`);
  return new Response('OK', { status: 200 });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizar(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '').replace(/\s+/g, ' ');
}

/**
 * Procesa mensajes de texto libre: "25 taxi", "gasté 40 en menú", "ingreso 500 freelance".
 * Usa el mismo parseText que ingest-transaction con cadena de decisión simplificada.
 */
async function handleTextMessage(
  supabase: ReturnType<typeof createClient>,
  from:    string,
  text:    string,
  profile: { id: string; nombre: string } | null,
): Promise<void> {
  if (!profile) {
    await sendWhatsAppReply(from,
      '❌ Tu número no está vinculado a ninguna cuenta de Family Finance.\n\nAbre la app → Configuración → WhatsApp para vincularlo.',
    );
    return;
  }

  const { data: catRows } = await supabase.from('v_categorias').select('nombre').neq('nombre', 'Por clasificar');
  const categorias = (catRows ?? []).map((r: { nombre: string }) => r.nombre);

  let parsed: Awaited<ReturnType<typeof parseTransactionText>>;
  try {
    parsed = await parseTransactionText(text, categorias);
  } catch {
    await sendWhatsAppReply(from, '⚠️ No pude interpretar el mensaje. Intenta: "25 taxi" o "40 almuerzo".');
    return;
  }

  if (!parsed) {
    await sendWhatsAppReply(from, '🤔 No pude identificar un monto válido. Intenta: "25 taxi" o "40 almuerzo".');
    return;
  }

  // Cadena de decisión
  const comercioNorm = normalizar(parsed.comercio);
  const { data: regla } = await supabase.from('reglas_categorizacion')
    .select('id, categoria, veces_aplicada').eq('user_id', profile.id).eq('comercio_normalizado', comercioNorm).maybeSingle();

  let categoria:       string;
  let autoClasificado: boolean;
  let estado:          string;
  let categoriaSug:    string | null = null;

  if (regla) {
    categoria       = (regla as { categoria: string }).categoria;
    autoClasificado = true;
    estado          = 'PROCESADO';
    supabase.from('reglas_categorizacion')
      .update({ veces_aplicada: (regla as { veces_aplicada: number }).veces_aplicada + 1 })
      .eq('id', (regla as { id: string }).id).then(() => {});
  } else if (parsed.confianza != null && parsed.confianza >= 0.90 && parsed.categoria_sugerida) {
    categoria       = parsed.categoria_sugerida;
    autoClasificado = true;
    estado          = 'PROCESADO';
  } else {
    categoria       = 'Por clasificar';
    autoClasificado = false;
    estado          = 'PENDIENTE_REVISION';
    categoriaSug    = parsed.categoria_sugerida;
  }

  const { error } = await supabase.from('transacciones').insert({
    user_id:            profile.id,
    tipo:               'gasto',
    monto:              parsed.monto,
    moneda:             parsed.moneda,
    tipo_cambio:        parsed.moneda === 'USD' ? null : 1.0,
    categoria,
    categoria_sugerida: categoriaSug,
    confianza_ia:       parsed.confianza,
    auto_clasificado:   autoClasificado,
    descripcion:        parsed.comercio,
    fecha:              new Date().toISOString().split('T')[0],
    metodo_pago:        'efectivo',
    fuente:             'whatsapp_texto',
    fuente_raw:         text,
    es_gasto_unico:     true,
    estado,
    activo:             true,
  });

  if (error) {
    console.error('Error insertando tx texto WA:', error);
    await sendWhatsAppReply(from, '❌ Error al guardar. Inténtalo de nuevo.');
    return;
  }

  const sym = parsed.moneda === 'USD' ? '$' : 'S/';
  const catLabel = autoClasificado ? categoria : (categoriaSug ? `${categoriaSug} (pendiente)` : 'Por clasificar (pendiente)');
  await sendWhatsAppReply(
    from,
    `✅ Gasto registrado\n\n💸 ${sym} ${parsed.monto.toFixed(2)} · ${parsed.comercio}\n🏷️ ${catLabel}\n\nAbre la app para revisar.`,
  );
}
