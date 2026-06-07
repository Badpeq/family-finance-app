import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Platform,
  ActivityIndicator, Modal, FlatList, KeyboardAvoidingView, ScrollView,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '@/lib/supabase';

type PagoTipo = 'tarjeta' | 'prestamo';

interface Tarjeta {
  id: string;
  banco: string;
  nombre_tarjeta: string;
  linea_credito: number;
  deuda_actual: number;
}

interface Prestamo {
  id: string;
  entidad_persona: string;
  tipo: 'recibido' | 'otorgado';
  monto_total: number;
  saldo_pendiente: number;
  monto_mensual: number | null;
  cuotas_estimadas: number | null;
  cuotas_pagadas: number;
}

const SYM: Record<string, string> = {
  PEN: 'S/', USD: '$', EUR: '€', BRL: 'R$', COP: '$', MXN: '$', ARS: '$', CLP: '$',
};

export default function Pagos() {
  const { moneda } = useLocalSearchParams<{ moneda?: string }>();
  const currency = moneda ?? 'PEN';

  const fmt = (n: number) => {
    const s = SYM[currency] ?? currency;
    return `${s} ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const [pagoTipo,  setPagoTipo]  = useState<PagoTipo>('tarjeta');
  const [tarjetas,  setTarjetas]  = useState<Tarjeta[]>([]);
  const [prestamos, setPrestamos] = useState<Prestamo[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const [selectedTarjeta,  setSelectedTarjeta]  = useState<Tarjeta | null>(null);
  const [selectedPrestamo, setSelectedPrestamo] = useState<Prestamo | null>(null);
  const [monto,       setMonto]       = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [fecha,       setFecha]       = useState(() => new Date().toISOString().slice(0, 10));

  const [showTarjetaPicker,  setShowTarjetaPicker]  = useState(false);
  const [showPrestamoPicker, setShowPrestamoPicker] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (pagoTipo === 'prestamo' && selectedPrestamo?.monto_mensual) {
      setMonto(String(selectedPrestamo.monto_mensual));
    }
  }, [selectedPrestamo]);

  const loadData = async () => {
    setLoadingData(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoadingData(false); return null; }

    const [tarjetasRes, prestamosRes] = await Promise.all([
      supabase
        .from('tarjetas_credito')
        .select('id, banco, nombre_tarjeta, linea_credito, deuda_actual')
        .eq('user_id', user.id)
        .order('creado_en', { ascending: true }),
      supabase
        .from('prestamos')
        .select('id, entidad_persona, tipo, monto_total, saldo_pendiente, monto_mensual, cuotas_estimadas, cuotas_pagadas')
        .eq('user_id', user.id)
        .gt('saldo_pendiente', 0)
        .order('creado_en', { ascending: true }),
    ]);

    const ts = (tarjetasRes.data ?? []) as Tarjeta[];
    const ps = (prestamosRes.data ?? []) as Prestamo[];
    setTarjetas(ts);
    setPrestamos(ps);
    setLoadingData(false);
    return { tarjetas: ts, prestamos: ps };
  };

  const handleGuardar = async () => {
    const m = parseFloat(monto.replace(',', '.'));
    if (isNaN(m) || m <= 0)                           { setError('Ingresa un monto válido.'); return; }
    if (pagoTipo === 'tarjeta' && !selectedTarjeta)   { setError('Selecciona una tarjeta.'); return; }
    if (pagoTipo === 'prestamo' && !selectedPrestamo) { setError('Selecciona un préstamo.'); return; }

    setError('');
    setLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const prevTarjetaId  = selectedTarjeta?.id;
    const prevPrestamoId = selectedPrestamo?.id;

    if (pagoTipo === 'tarjeta') {
      const { error: e } = await supabase.from('pagos_tarjeta').insert({
        user_id:     user.id,
        tarjeta_id:  selectedTarjeta!.id,
        monto:       m,
        fecha,
        descripcion: descripcion.trim() || null,
      });
      if (e) { setError(e.message); setLoading(false); return; }
    } else {
      const { error: e } = await supabase.from('prestamos_abonos').insert({
        prestamo_id: selectedPrestamo!.id,
        monto:       m,
        fecha,
        descripcion: descripcion.trim() || null,
      });
      if (e) { setError(e.message); setLoading(false); return; }
    }

    setLoading(false);
    setSuccess(true);
    setMonto('');
    setDescripcion('');

    // Reload and sync selected entity to show updated saldo
    const result = await loadData();
    if (result) {
      if (pagoTipo === 'tarjeta' && prevTarjetaId) {
        const fresh = result.tarjetas.find(t => t.id === prevTarjetaId);
        if (fresh) setSelectedTarjeta(fresh);
      } else if (pagoTipo === 'prestamo' && prevPrestamoId) {
        const fresh = result.prestamos.find(p => p.id === prevPrestamoId);
        if (fresh) setSelectedPrestamo(fresh);
      }
    }
  };

  const resetForm = () => {
    setSuccess(false);
    setError('');
    setMonto('');
    setDescripcion('');
    setSelectedTarjeta(null);
    setSelectedPrestamo(null);
  };

  const switchTipo = (t: PagoTipo) => {
    setPagoTipo(t);
    setSelectedTarjeta(null);
    setSelectedPrestamo(null);
    setError('');
    setSuccess(false);
  };

  const selectTarjeta = (t: Tarjeta) => {
    setSelectedTarjeta(t);
    setShowTarjetaPicker(false);
    setSuccess(false);
    setError('');
  };

  const selectPrestamo = (p: Prestamo) => {
    setSelectedPrestamo(p);
    setShowPrestamoPicker(false);
    setSuccess(false);
    setError('');
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.wrapper}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()}>
              <Text style={styles.backText}>‹ Volver</Text>
            </TouchableOpacity>
            <Text style={styles.title}>Registrar Pago</Text>
            <View style={{ width: 60 }} />
          </View>

          {/* Toggle */}
          <View style={styles.toggle}>
            <TouchableOpacity
              style={[styles.toggleOpt, pagoTipo === 'tarjeta' && styles.toggleActive]}
              onPress={() => switchTipo('tarjeta')}
            >
              <Text style={[styles.toggleText, pagoTipo === 'tarjeta' && styles.toggleActiveText]}>
                💳  Tarjeta
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleOpt, pagoTipo === 'prestamo' && styles.toggleActive]}
              onPress={() => switchTipo('prestamo')}
            >
              <Text style={[styles.toggleText, pagoTipo === 'prestamo' && styles.toggleActiveText]}>
                📋  Préstamo
              </Text>
            </TouchableOpacity>
          </View>

          {loadingData ? (
            <ActivityIndicator color="#3B82F6" style={{ marginTop: 40 }} />
          ) : (
            <View style={styles.form}>
              {/* Tarjeta selector */}
              {pagoTipo === 'tarjeta' && (
                <>
                  <Text style={styles.label}>Tarjeta de Crédito</Text>
                  <TouchableOpacity style={styles.selector} onPress={() => setShowTarjetaPicker(true)}>
                    {selectedTarjeta ? (
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.selMain} numberOfLines={1}>
                          {selectedTarjeta.banco} · {selectedTarjeta.nombre_tarjeta}
                        </Text>
                        <Text style={styles.selSub}>
                          Deuda actual: {fmt(Number(selectedTarjeta.deuda_actual))}
                        </Text>
                      </View>
                    ) : (
                      <Text style={styles.selPlaceholder}>Seleccionar tarjeta</Text>
                    )}
                    <Text style={styles.chevron}>›</Text>
                  </TouchableOpacity>
                </>
              )}

              {/* Préstamo selector */}
              {pagoTipo === 'prestamo' && (
                <>
                  <Text style={styles.label}>Préstamo</Text>
                  <TouchableOpacity style={styles.selector} onPress={() => setShowPrestamoPicker(true)}>
                    {selectedPrestamo ? (
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.selMain} numberOfLines={1}>
                          {selectedPrestamo.entidad_persona}
                        </Text>
                        <Text style={styles.selSub}>
                          Saldo: {fmt(Number(selectedPrestamo.saldo_pendiente))}
                          {selectedPrestamo.cuotas_estimadas
                            ? `  ·  Cuota ${selectedPrestamo.cuotas_pagadas + 1} de ${selectedPrestamo.cuotas_estimadas}`
                            : ''}
                        </Text>
                      </View>
                    ) : (
                      <Text style={styles.selPlaceholder}>Seleccionar préstamo</Text>
                    )}
                    <Text style={styles.chevron}>›</Text>
                  </TouchableOpacity>
                </>
              )}

              <Text style={styles.label}>Monto</Text>
              <TextInput
                style={styles.input}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="#9CA3AF"
                value={monto}
                onChangeText={setMonto}
              />

              <Text style={styles.label}>Fecha</Text>
              <TextInput
                style={styles.input}
                placeholder="AAAA-MM-DD"
                placeholderTextColor="#9CA3AF"
                value={fecha}
                onChangeText={setFecha}
              />

              <Text style={styles.label}>Descripción (opcional)</Text>
              <TextInput
                style={styles.input}
                placeholder="Ej: Cuota 3, Pago mínimo…"
                placeholderTextColor="#9CA3AF"
                value={descripcion}
                onChangeText={setDescripcion}
              />

              {!!error && <Text style={styles.errorText}>{error}</Text>}

              {success && (
                <View style={styles.successBanner}>
                  <Text style={styles.successText}>✓ Pago registrado correctamente</Text>
                  <TouchableOpacity onPress={resetForm}>
                    <Text style={styles.nuevoLink}>Nuevo pago</Text>
                  </TouchableOpacity>
                </View>
              )}

              <TouchableOpacity
                style={[styles.saveBtn, loading && styles.btnDisabled]}
                onPress={handleGuardar}
                disabled={loading}
              >
                {loading
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.saveBtnText}>Registrar Pago</Text>
                }
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>

      {/* ── Tarjeta picker ── */}
      <Modal visible={showTarjetaPicker} animationType="slide" transparent>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Seleccionar Tarjeta</Text>
              <TouchableOpacity onPress={() => setShowTarjetaPicker(false)}>
                <Text style={styles.closeBtn}>Cerrar</Text>
              </TouchableOpacity>
            </View>
            {tarjetas.length === 0 ? (
              <Text style={styles.emptyPicker}>Sin tarjetas registradas</Text>
            ) : (
              <FlatList
                data={tarjetas}
                keyExtractor={t => t.id}
                ItemSeparatorComponent={() => <View style={styles.sep} />}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.pickerRow}
                    onPress={() => selectTarjeta(item)}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.pickerMain} numberOfLines={1}>
                        {item.banco} · {item.nombre_tarjeta}
                      </Text>
                      <Text style={styles.pickerSub}>
                        Deuda: {fmt(Number(item.deuda_actual))}
                        {Number(item.linea_credito) > 0
                          ? `  /  Línea: ${fmt(Number(item.linea_credito))}`
                          : ''}
                      </Text>
                    </View>
                    {selectedTarjeta?.id === item.id && <Text style={styles.check}>✓</Text>}
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      </Modal>

      {/* ── Préstamo picker ── */}
      <Modal visible={showPrestamoPicker} animationType="slide" transparent>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Seleccionar Préstamo</Text>
              <TouchableOpacity onPress={() => setShowPrestamoPicker(false)}>
                <Text style={styles.closeBtn}>Cerrar</Text>
              </TouchableOpacity>
            </View>
            {prestamos.length === 0 ? (
              <Text style={styles.emptyPicker}>Sin préstamos activos</Text>
            ) : (
              <FlatList
                data={prestamos}
                keyExtractor={p => p.id}
                ItemSeparatorComponent={() => <View style={styles.sep} />}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.pickerRow}
                    onPress={() => selectPrestamo(item)}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.pickerMain} numberOfLines={1}>
                        {item.entidad_persona}
                      </Text>
                      <Text style={styles.pickerSub}>
                        {item.tipo === 'recibido' ? 'Recibido' : 'Otorgado'}
                        {'  ·  '}
                        Saldo: {fmt(Number(item.saldo_pendiente))}
                      </Text>
                    </View>
                    {selectedPrestamo?.id === item.id && <Text style={styles.check}>✓</Text>}
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const isWeb = Platform.OS === 'web';

const styles = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: '#F3F4F6' },
  content: { flexGrow: 1, alignItems: 'center', paddingBottom: 40 },
  wrapper: { width: '100%', maxWidth: 600, paddingHorizontal: 20 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: isWeb ? 32 : 60, marginBottom: 24,
  },
  backText: { fontSize: 16, color: '#3B82F6', fontWeight: '500' },
  title:    { fontSize: 20, fontWeight: '700', color: '#111827' },

  toggle: {
    flexDirection: 'row', backgroundColor: '#E5E7EB', borderRadius: 12,
    padding: 4, marginBottom: 28,
  },
  toggleOpt: {
    flex: 1, paddingVertical: 10, borderRadius: 9,
    justifyContent: 'center', alignItems: 'center',
  },
  toggleActive:     { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  toggleText:       { fontSize: 14, fontWeight: '600', color: '#6B7280' },
  toggleActiveText: { color: '#111827' },

  form: {},

  label: { fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 },
  input: {
    height: 52, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: 12, paddingHorizontal: 16, fontSize: 16, color: '#111827', marginBottom: 16,
  },
  selector: {
    height: 64, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: 12, paddingHorizontal: 16, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-between', marginBottom: 16,
  },
  selMain:        { fontSize: 15, fontWeight: '600', color: '#111827' },
  selSub:         { fontSize: 12, color: '#6B7280', marginTop: 2 },
  selPlaceholder: { fontSize: 15, color: '#9CA3AF' },
  chevron:        { fontSize: 22, color: '#9CA3AF', marginLeft: 8 },

  errorText:    { color: '#DC2626', fontSize: 13, marginBottom: 12, backgroundColor: '#FEF2F2', borderRadius: 8, padding: 10 },
  successBanner: { backgroundColor: '#D1FAE5', borderRadius: 8, padding: 12, marginBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  successText:  { color: '#059669', fontSize: 13, fontWeight: '600', flex: 1 },
  nuevoLink:    { color: '#059669', fontSize: 13, fontWeight: '700', textDecorationLine: 'underline', marginLeft: 8 },

  saveBtn: {
    height: 52, backgroundColor: '#3B82F6', borderRadius: 12,
    justifyContent: 'center', alignItems: 'center', marginTop: 4,
  },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  btnDisabled: { opacity: 0.6 },

  // Modals
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end', alignItems: 'center',
  },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    width: '100%', maxWidth: 600, maxHeight: '70%', paddingBottom: 36,
  },
  sheetHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  closeBtn:   { fontSize: 15, color: '#3B82F6', fontWeight: '500' },
  emptyPicker: { fontSize: 14, color: '#9CA3AF', textAlign: 'center', paddingVertical: 32 },

  pickerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  pickerMain: { fontSize: 15, fontWeight: '600', color: '#111827' },
  pickerSub:  { fontSize: 12, color: '#6B7280', marginTop: 2 },
  check:      { fontSize: 16, color: '#3B82F6', fontWeight: '700', marginLeft: 12, flexShrink: 0 },
  sep:        { height: 1, backgroundColor: '#F3F4F6', marginHorizontal: 20 },
});
