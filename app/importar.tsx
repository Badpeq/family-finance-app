import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Modal, SafeAreaView,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { parseVoucherText, parseTicketItems, type ParsedLine, type ParsedItem } from '@/lib/parseVoucher';
import { pickAndOcr, type OcrSource } from '@/lib/ocrImage';
import { importStore } from '@/lib/importStore';

const CATS = [
  'Alimentación','Transporte','Vivienda','Entretenimiento',
  'Salud','Educación','Ropa','Servicios','Restaurantes','Otros',
];
const ICON: Record<string,string> = {
  Alimentación:'🛒', Transporte:'🚗', Vivienda:'🏠', Entretenimiento:'🎬',
  Salud:'💊', Educación:'📚', Ropa:'👕', Servicios:'⚡', Restaurantes:'🍽️', Otros:'📦',
};
const SYM: Record<string,string> = { PEN:'S/', USD:'$', EUR:'€' };

type Mode = 'voucher' | 'ticket';
type Stage = 'input' | 'preview' | 'items' | 'saving' | 'done';

export default function Importar() {
  const { modo } = useLocalSearchParams<{ modo?: string }>();
  const [mode,  setMode]  = useState<Mode>(modo === 'ticket' ? 'ticket' : 'voucher');
  const [stage, setStage] = useState<Stage>('input');
  const [texto, setTexto] = useState('');

  // Voucher flow
  const [lines,    setLines]    = useState<ParsedLine[]>([]);
  const [currency, setCurrency] = useState('PEN');

  // Ticket flow
  const [items,       setItems]       = useState<ParsedItem[]>([]);
  const [ticketTotal, setTicketTotal] = useState('');
  const [ticketComercio, setTicketComercio] = useState('');
  const [ticketFecha,    setTicketFecha]    = useState(new Date().toISOString().slice(0,10));

  // Cat picker
  const [pickerIdx,     setPickerIdx]     = useState<number | null>(null);
  const [showCatPicker, setShowCatPicker] = useState(false);

  const [ocring, setOcring] = useState(false);
  const [error,  setError]  = useState('');
  const [saved,  setSaved]  = useState(0);

  // Prefill desde Quick Add (foto capturada antes de navegar).
  // Importante: pasamos el texto y modo directamente a parsearConTexto()
  // para evitar el bug de closure donde handleParse() ve texto='' (estado inicial).
  useEffect(() => {
    const prefill = importStore.getText();
    if (!prefill) return;
    const auto       = importStore.getAutoparse();
    const storedMode = importStore.getMode();
    importStore.clear();
    setTexto(prefill);
    setMode(storedMode);
    if (auto) parsearConTexto(prefill, storedMode);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Parse (acepta texto y modo como parámetros para evitar closure stale) ──

  const parsearConTexto = (input: string, currentMode: Mode) => {
    setError('');
    const txt = input.trim();
    if (!txt) { setError('Pega el texto del voucher o ticket.'); return; }

    if (currentMode === 'voucher') {
      const parsed = parseVoucherText(txt);
      if (parsed.length === 0) { setError('No se detectaron transacciones. Revisa el formato del texto.'); return; }
      setLines(parsed);
      setStage('preview');
    } else {
      const parsed = parseTicketItems(txt);
      if (parsed.length === 0) { setError('No se detectaron productos. Revisa el formato del texto.'); return; }
      setItems(parsed);
      setTicketTotal(parsed.reduce((s, i) => s + i.precio_total, 0).toFixed(2));
      setStage('items');
    }
  };

  // Lee del estado actual (para el botón manual)
  const handleParse = () => parsearConTexto(texto, mode);

  // ── OCR desde cámara o galería — auto-parsea al terminar ────────────────

  const handleOcr = async (source: OcrSource) => {
    setError('');
    setOcring(true);
    try {
      const text = await pickAndOcr(source);
      setTexto(text);
      // Auto-parsea con el texto recién recibido (sin depender del estado)
      parsearConTexto(text, mode);
    } catch (e: any) {
      if (e?.message !== 'cancelled') setError(e?.message ?? 'Error al procesar la imagen.');
    } finally {
      setOcring(false);
    }
  };

  // ── Toggle excluir línea ─────────────────────────────────────────────────

  const toggleExcluir = (id: string) => {
    setLines(prev => prev.map(l => l.id === id ? { ...l, excluir: !l.excluir } : l));
  };

  const setCategoria = (id: string, cat: string) => {
    setLines(prev => prev.map(l => l.id === id ? { ...l, categoria: cat } : l));
  };

  // ── Guardar voucher (bulk insert) ────────────────────────────────────────

  const handleSaveVoucher = async () => {
    const activas = lines.filter(l => !l.excluir);
    if (activas.length === 0) { setError('Selecciona al menos una transacción.'); return; }
    setStage('saving');

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Sesión expirada.'); setStage('preview'); return; }

    const rows = activas.map(l => ({
      user_id:       user.id,
      tipo:          'gasto' as const,
      monto:         l.monto,
      categoria:     l.categoria,
      descripcion:   l.comercio,
      moneda:        l.moneda,
      tipo_cambio:   1,
      activo:        true,
      es_gasto_unico:false,
      fecha:         l.fecha,
      fuente:        'importado',
      fuente_raw:    texto.slice(0, 2000),
      creado_en:     l.fecha + 'T12:00:00',
    }));

    const { error: err } = await supabase.from('transacciones').insert(rows);
    if (err) { setError(err.message); setStage('preview'); return; }
    setSaved(activas.length);
    setStage('done');
  };

  // ── Guardar ticket (cascada transaccion + detalles) ──────────────────────

  const handleSaveTicket = async () => {
    if (!ticketComercio.trim()) { setError('Escribe el nombre del comercio.'); return; }
    const total = parseFloat(ticketTotal.replace(',','.'));
    if (isNaN(total) || total <= 0) { setError('Monto total inválido.'); return; }
    setStage('saving');

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Sesión expirada.'); setStage('items'); return; }

    // 1. Insertar transacción consolidada
    const { data: txData, error: txErr } = await supabase.from('transacciones').insert({
      user_id:       user.id,
      tipo:          'gasto',
      monto:         total,
      categoria:     'Alimentación',
      descripcion:   ticketComercio.trim(),
      moneda:        currency,
      tipo_cambio:   1,
      activo:        true,
      es_gasto_unico:false,
      fecha:         ticketFecha,
      fuente:        'ticket',
      fuente_raw:    texto.slice(0, 2000),
      creado_en:     ticketFecha + 'T12:00:00',
    }).select('id').single();

    if (txErr || !txData) { setError(txErr?.message ?? 'Error al guardar.'); setStage('items'); return; }

    // 2. Insertar detalles en cascada
    if (items.length > 0) {
      const detalles = items.map(it => ({
        transaccion_id:  txData.id,
        producto:        it.producto,
        cantidad:        it.cantidad,
        precio_unitario: it.precio_unitario,
        precio_total:    it.precio_total,
      }));
      const { error: detErr } = await supabase.from('transaccion_detalles').insert(detalles);
      if (detErr) console.warn('Detalles no guardados:', detErr.message);
    }

    setSaved(1);
    setStage('done');
  };

  // ── Renders ──────────────────────────────────────────────────────────────

  if (stage === 'done') {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.doneWrap}>
          <Text style={s.doneIcon}>✅</Text>
          <Text style={s.doneTitle}>
            {mode === 'voucher'
              ? `${saved} transacción${saved !== 1 ? 'es' : ''} importada${saved !== 1 ? 's' : ''}`
              : 'Ticket guardado con desglose'}
          </Text>
          <Text style={s.doneSub}>Ya aparecen en tu historial y dashboard.</Text>
          <TouchableOpacity style={s.doneBtn} onPress={() => router.replace('/(tabs)')}>
            <Text style={s.doneBtnText}>Ir al Dashboard</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.doneLink} onPress={() => {
            setStage('input'); setTexto(''); setLines([]); setItems([]); setSaved(0); setError('');
          }}>
            <Text style={s.doneLinkText}>Importar otro</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => stage === 'input' ? router.back() : setStage('input')} style={s.backBtn}>
            <Text style={s.backArrow}>{stage === 'input' ? '←' : '← Volver'}</Text>
          </TouchableOpacity>
          <Text style={s.headerTitle}>
            {stage === 'input'  ? '📥 Importar' :
             stage === 'preview'? '✅ Pre-aprobación' :
             stage === 'items'  ? '🛒 Desglose de ticket' :
             stage === 'saving' ? 'Guardando...' : ''}
          </Text>
        </View>

        {/* ── STAGE: input ── */}
        {stage === 'input' && (
          <ScrollView contentContainerStyle={s.inner} keyboardShouldPersistTaps="handled">

            {/* Selector de modo */}
            <View style={s.modeRow}>
              {(['voucher','ticket'] as Mode[]).map(m => (
                <TouchableOpacity key={m} style={[s.modeBtn, mode === m && s.modeBtnOn]}
                  onPress={() => { setMode(m); setError(''); }}>
                  <Text style={s.modeBtnIcon}>{m === 'voucher' ? '💳' : '🧾'}</Text>
                  <Text style={[s.modeBtnText, mode === m && s.modeBtnTextOn]}>
                    {m === 'voucher' ? 'Estado de cuenta' : 'Ticket supermercado'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Instrucciones */}
            <View style={s.infoBox}>
              {mode === 'voucher' ? (
                <>
                  <Text style={s.infoTitle}>¿Cómo usar?</Text>
                  <Text style={s.infoText}>
                    1. Abre tu app de banco o correo con el estado de cuenta{'\n'}
                    2. Selecciona y copia el listado de movimientos{'\n'}
                    3. Pégalo abajo — detectamos BCP, BBVA, Interbank y formato Visa/MC
                  </Text>
                </>
              ) : (
                <>
                  <Text style={s.infoTitle}>¿Cómo usar?</Text>
                  <Text style={s.infoText}>
                    Copia el texto del ticket (PDF o foto → texto).{'\n'}
                    Formato: una línea por producto con precio al final.{'\n'}
                    Ej: {"\"Leche Gloria 1L   x2   8.50\""}
                  </Text>
                </>
              )}
            </View>

            {/* Captura con cámara o galería */}
            <View style={s.photoRow}>
              <TouchableOpacity style={s.photoBtn} onPress={() => handleOcr('camera')} disabled={ocring}>
                <Text style={s.photoIcon}>📷</Text>
                <Text style={s.photoBtnText}>Tomar foto</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.photoBtn} onPress={() => handleOcr('gallery')} disabled={ocring}>
                <Text style={s.photoIcon}>🖼️</Text>
                <Text style={s.photoBtnText}>Elegir foto</Text>
              </TouchableOpacity>
            </View>

            {ocring && (
              <View style={s.ocrOverlay}>
                <ActivityIndicator color="#7C3AED" size="large" />
                <Text style={s.ocrText}>Leyendo imagen con Google Vision...</Text>
              </View>
            )}

            {/* Zona de pegado */}
            <View style={s.orRow}>
              <View style={s.orLine} /><Text style={s.orText}>o pega el texto manualmente</Text><View style={s.orLine} />
            </View>
            <TextInput
              style={s.textArea}
              multiline
              numberOfLines={12}
              placeholder={mode === 'voucher'
                ? 'COMPRA 10/06 METRO S/ 45.50\nCOMPRA 11/06 UBER 18.00\nCOMPRA 12/06 NETFLIX 45.00...'
                : 'Leche Gloria 1L   x2   8.50\nPan Bimbo 500g   4.20\nAceite Primor 1L  9.90...'}
              placeholderTextColor="#9CA3AF"
              value={texto}
              onChangeText={setTexto}
              textAlignVertical="top"
            />

            {!!error && <View style={s.errBox}><Text style={s.errText}>{error}</Text></View>}

            <TouchableOpacity style={s.btn} onPress={handleParse}>
              <Text style={s.btnText}>
                {mode === 'voucher' ? 'Detectar transacciones →' : 'Analizar productos →'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* ── STAGE: preview (voucher) ── */}
        {stage === 'preview' && (
          <>
            <View style={s.previewInfo}>
              <Text style={s.previewSub}>
                {lines.filter(l => !l.excluir).length} de {lines.length} transacciones seleccionadas.
                Toca la categoría para cambiarla.
              </Text>
            </View>
            <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 100 }}>
              {lines.map((line) => (
                <View key={line.id} style={[s.previewRow, line.excluir && s.previewRowOff]}>
                  <TouchableOpacity style={s.previewCheck} onPress={() => toggleExcluir(line.id)}>
                    <View style={[s.check, !line.excluir && s.checkOn]}>
                      {!line.excluir && <Text style={s.checkMark}>✓</Text>}
                    </View>
                  </TouchableOpacity>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[s.previewComercio, line.excluir && { color: '#9CA3AF' }]} numberOfLines={1}>
                      {line.comercio}
                    </Text>
                    <Text style={s.previewFecha}>{line.fecha}</Text>
                    <TouchableOpacity style={s.catTag}
                      onPress={() => { setPickerIdx(lines.indexOf(line)); setShowCatPicker(true); }}>
                      <Text style={s.catTagText}>{ICON[line.categoria] ?? '📦'} {line.categoria} ▾</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={[s.previewMonto, line.excluir && { color: '#9CA3AF' }]}>
                    {SYM[line.moneda] ?? line.moneda} {line.monto.toFixed(2)}
                  </Text>
                </View>
              ))}
            </ScrollView>

            {!!error && <View style={[s.errBox, { margin: 12 }]}><Text style={s.errText}>{error}</Text></View>}

            <View style={s.bottomBar}>
              <View style={{ flex: 1 }}>
                <Text style={s.bottomTotal}>
                  Total: {SYM[currency] ?? 'S/'} {lines.filter(l=>!l.excluir).reduce((s,l)=>s+l.monto,0).toFixed(2)}
                </Text>
                <Text style={s.bottomCount}>{lines.filter(l=>!l.excluir).length} transacciones</Text>
              </View>
              <TouchableOpacity style={s.btn} onPress={handleSaveVoucher}>
                <Text style={s.btnText}>Guardar todo</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* ── STAGE: items (ticket) ── */}
        {stage === 'items' && (
          <>
            <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 120 }}>

              {/* Datos del ticket */}
              <View style={s.ticketMeta}>
                <Text style={s.label}>Comercio</Text>
                <TextInput style={s.input} placeholder="Metro, Plaza Vea, Wong..."
                  placeholderTextColor="#9CA3AF" value={ticketComercio}
                  onChangeText={setTicketComercio} />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.label}>Fecha</Text>
                    <TextInput style={s.input} placeholder="YYYY-MM-DD"
                      placeholderTextColor="#9CA3AF" value={ticketFecha}
                      onChangeText={setTicketFecha} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.label}>Total (S/)</Text>
                    <TextInput style={s.input} placeholder="0.00"
                      placeholderTextColor="#9CA3AF" keyboardType="decimal-pad"
                      value={ticketTotal} onChangeText={setTicketTotal} />
                  </View>
                </View>
              </View>

              {/* Lista de productos */}
              <Text style={s.sectionLabel}>{items.length} PRODUCTOS DETECTADOS</Text>
              {items.map((it, i) => (
                <View key={i} style={s.itemRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.itemName} numberOfLines={1}>{it.producto}</Text>
                    <Text style={s.itemQty}>x{it.cantidad} · S/ {it.precio_unitario.toFixed(2)} c/u</Text>
                  </View>
                  <Text style={s.itemTotal}>S/ {it.precio_total.toFixed(2)}</Text>
                </View>
              ))}

              {!!error && <View style={s.errBox}><Text style={s.errText}>{error}</Text></View>}
            </ScrollView>

            <View style={s.bottomBar}>
              <View style={{ flex: 1 }}>
                <Text style={s.bottomTotal}>Total: S/ {ticketTotal}</Text>
                <Text style={s.bottomCount}>{items.length} productos</Text>
              </View>
              <TouchableOpacity style={s.btn} onPress={handleSaveTicket}>
                <Text style={s.btnText}>Guardar ticket</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* ── STAGE: saving ── */}
        {stage === 'saving' && (
          <View style={s.savingWrap}>
            <ActivityIndicator size="large" color="#7C3AED" />
            <Text style={s.savingText}>Guardando transacciones...</Text>
          </View>
        )}

      </KeyboardAvoidingView>

      {/* ── Category Picker Modal ── */}
      <Modal visible={showCatPicker} animationType="slide" transparent>
        <View style={s.modalBg}>
          <View style={s.modalSheet}>
            <View style={s.modalHead}>
              <Text style={s.modalTitle}>Categoría</Text>
              <TouchableOpacity onPress={() => setShowCatPicker(false)}>
                <Text style={s.modalClose}>Cerrar</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              {CATS.map((cat, i) => (
                <View key={cat}>
                  <TouchableOpacity style={s.catOpt} onPress={() => {
                    if (pickerIdx !== null) setCategoria(lines[pickerIdx].id, cat);
                    setShowCatPicker(false);
                  }}>
                    <Text style={s.catOptText}>{ICON[cat] ?? '📦'} {cat}</Text>
                    {pickerIdx !== null && lines[pickerIdx]?.categoria === cat && (
                      <Text style={{ color: '#7C3AED', fontSize: 18 }}>✓</Text>
                    )}
                  </TouchableOpacity>
                  {i < CATS.length - 1 && <View style={s.sep} />}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: '#F9FAFB' },
  header:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
             paddingTop: Platform.OS === 'android' ? 44 : 12, paddingBottom: 12,
             borderBottomWidth: 1, borderBottomColor: '#F3F4F6', backgroundColor: '#fff', gap: 12 },
  backBtn: { paddingRight: 4 },
  backArrow:   { fontSize: 16, color: '#374151', fontWeight: '500' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#111827' },

  inner:   { padding: 20, paddingBottom: 40 },
  label:   { fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6, marginTop: 14 },
  input:   { height: 48, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB',
             borderRadius: 12, paddingHorizontal: 14, fontSize: 15, color: '#111827' },
  textArea:{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 14,
             padding: 14, fontSize: 13, color: '#111827', minHeight: 180, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  errBox:  { backgroundColor: '#FEF2F2', borderRadius: 10, padding: 12, marginTop: 10 },
  errText: { color: '#DC2626', fontSize: 13 },

  btn:     { backgroundColor: '#7C3AED', borderRadius: 12, height: 50,
             justifyContent: 'center', alignItems: 'center', marginTop: 16 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  photoRow:   { flexDirection: 'row', gap: 10, marginTop: 4, marginBottom: 4 },
  photoBtn:   { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                gap: 6, backgroundColor: '#F3F4F6', borderRadius: 12, paddingVertical: 14,
                borderWidth: 1.5, borderColor: '#E5E7EB' },
  photoIcon:  { fontSize: 20 },
  photoBtnText:{ fontSize: 13, fontWeight: '600', color: '#374151' },
  ocrOverlay: { alignItems: 'center', gap: 10, paddingVertical: 20 },
  ocrText:    { fontSize: 13, color: '#7C3AED', fontWeight: '500' },
  orRow:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, marginBottom: 2 },
  orLine:     { flex: 1, height: 1, backgroundColor: '#E5E7EB' },
  orText:     { fontSize: 11, color: '#9CA3AF', fontWeight: '500' },

  modeRow: { flexDirection: 'row', gap: 10, marginBottom: 4 },
  modeBtn: { flex: 1, backgroundColor: '#F3F4F6', borderRadius: 14, padding: 14,
             alignItems: 'center', gap: 6, borderWidth: 2, borderColor: 'transparent' },
  modeBtnOn:   { backgroundColor: '#EDE9FE', borderColor: '#7C3AED' },
  modeBtnIcon: { fontSize: 26 },
  modeBtnText: { fontSize: 12, fontWeight: '600', color: '#6B7280', textAlign: 'center' },
  modeBtnTextOn:{ color: '#5B21B6' },

  infoBox:   { backgroundColor: '#F0FDF4', borderRadius: 12, padding: 14, marginBottom: 4,
               borderLeftWidth: 3, borderLeftColor: '#22C55E' },
  infoTitle: { fontSize: 13, fontWeight: '700', color: '#15803D', marginBottom: 4 },
  infoText:  { fontSize: 12, color: '#166534', lineHeight: 19 },

  // Preview
  previewInfo:    { backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  previewSub:     { fontSize: 12, color: '#6B7280' },
  previewRow:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
                    borderRadius: 12, padding: 12, marginBottom: 6, gap: 10,
                    shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 4, elevation: 1 },
  previewRowOff:  { opacity: 0.45 },
  previewCheck:   { padding: 4 },
  check:          { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#D1D5DB',
                    justifyContent: 'center', alignItems: 'center' },
  checkOn:        { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  checkMark:      { color: '#fff', fontSize: 12, fontWeight: '800' },
  previewComercio:{ fontSize: 14, fontWeight: '600', color: '#111827', marginBottom: 2 },
  previewFecha:   { fontSize: 11, color: '#9CA3AF', marginBottom: 4 },
  previewMonto:   { fontSize: 14, fontWeight: '700', color: '#DC2626' },
  catTag:         { backgroundColor: '#EDE9FE', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  catTagText:     { fontSize: 11, color: '#5B21B6', fontWeight: '600' },

  bottomBar:    { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12,
                  backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#F3F4F6',
                  paddingBottom: Platform.OS === 'ios' ? 32 : 16 },
  bottomTotal:  { fontSize: 15, fontWeight: '700', color: '#111827' },
  bottomCount:  { fontSize: 11, color: '#9CA3AF', marginTop: 2 },

  // Ticket items
  ticketMeta:   { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 12 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#9CA3AF', letterSpacing: 0.8,
                  textTransform: 'uppercase', marginBottom: 8, marginTop: 4 },
  itemRow:      { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
                  borderRadius: 10, padding: 12, marginBottom: 6,
                  shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 3, elevation: 1 },
  itemName:     { fontSize: 14, fontWeight: '600', color: '#111827', marginBottom: 2 },
  itemQty:      { fontSize: 11, color: '#9CA3AF' },
  itemTotal:    { fontSize: 14, fontWeight: '700', color: '#374151' },

  savingWrap:  { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  savingText:  { fontSize: 15, color: '#6B7280' },

  doneWrap:    { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  doneIcon:    { fontSize: 56, marginBottom: 16 },
  doneTitle:   { fontSize: 22, fontWeight: '800', color: '#111827', textAlign: 'center', marginBottom: 8 },
  doneSub:     { fontSize: 15, color: '#6B7280', textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  doneBtn:     { backgroundColor: '#7C3AED', borderRadius: 14, height: 52, paddingHorizontal: 32,
                 justifyContent: 'center', alignItems: 'center', width: '100%' },
  doneBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  doneLink:    { marginTop: 16 },
  doneLinkText:{ fontSize: 14, color: '#9CA3AF', textDecorationLine: 'underline' },

  modalBg:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '65%' },
  modalHead:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  modalClose: { fontSize: 14, color: '#7C3AED', fontWeight: '500' },
  catOpt:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                paddingHorizontal: 20, paddingVertical: 14 },
  catOptText: { fontSize: 15, color: '#111827' },
  sep:        { height: 1, backgroundColor: '#F3F4F6' },
});
