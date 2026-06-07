import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
  Modal, FlatList, SafeAreaView, ScrollView,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '@/lib/supabase';

// ── Types ─────────────────────────────────────────────────────
type Subtipo = 'abono' | 'retiro' | 'interes';

interface CuentaAhorro {
  id: string;
  nombre_cuenta: string;
  saldo_actual: number;
}

// ── Constants ─────────────────────────────────────────────────
const CURRENCY_SYMBOL: Record<string, string> = {
  PEN: 'S/', USD: '$', EUR: '€', BRL: 'R$',
  COP: '$',  MXN: '$', ARS: '$', CLP: '$',
};

const TABS: { key: Subtipo; label: string; accent: string; headerBg: string; desc: string }[] = [
  {
    key: 'abono', label: 'Abono', accent: '#0891B2', headerBg: '#E0F2FE',
    desc: 'Transfiere dinero de tus ingresos al fondo. Reduce tu balance disponible y suma al saldo de la cuenta.',
  },
  {
    key: 'retiro', label: 'Retiro', accent: '#7C3AED', headerBg: '#EDE9FE',
    desc: 'Rescata dinero del fondo hacia tu balance disponible. Resta del saldo de la cuenta.',
  },
  {
    key: 'interes', label: 'Interés / Rendimiento', accent: '#059669', headerBg: '#D1FAE5',
    desc: 'Registra rendimientos o intereses ganados. Suma al saldo de la cuenta sin afectar tu balance corriente.',
  },
];

// ── Component ─────────────────────────────────────────────────
export default function Ahorros() {
  const { moneda } = useLocalSearchParams<{ moneda?: string }>();
  const simbolo    = CURRENCY_SYMBOL[moneda ?? 'PEN'] ?? 'S/';

  // ── Tab state
  const [subtipo, setSubtipo] = useState<Subtipo>('abono');
  const tab = TABS.find(t => t.key === subtipo)!;

  // ── Cuentas de ahorro
  const [cuentas,           setCuentas]           = useState<CuentaAhorro[]>([]);
  const [cuentaId,          setCuentaId]          = useState('');
  const [loadingCuentas,    setLoadingCuentas]    = useState(true);
  const [showCuentaPicker,  setShowCuentaPicker]  = useState(false);
  const [showNuevaCuenta,        setShowNuevaCuenta]        = useState(false);
  const [nuevaCuentaNombre,      setNuevaCuentaNombre]      = useState('');
  const [nuevaCuentaSaldoInicial,setNuevaCuentaSaldoInicial]= useState('');
  const [savingCuenta,           setSavingCuenta]           = useState(false);

  // ── Form state
  const [monto,      setMonto]   = useState('');
  const [descripcion, setDesc]   = useState('');
  const [loading,    setLoading] = useState(false);
  const [error,      setError]   = useState('');

  // ── Load cuentas
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !mounted) return;
      const { data } = await supabase
        .from('cuentas_ahorro')
        .select('id, nombre_cuenta, saldo_actual')
        .eq('user_id', user.id)
        .order('creado_en', { ascending: true });
      if (mounted && data) {
        setCuentas(data);
        if (data.length === 1) setCuentaId(data[0].id); // auto-select if only one
      }
      if (mounted) setLoadingCuentas(false);
    })();
    return () => { mounted = false; };
  }, []);

  const cuentaActiva = cuentas.find(c => c.id === cuentaId);

  // ── Handlers
  const handleCrearCuenta = async () => {
    if (!nuevaCuentaNombre.trim()) return;
    setSavingCuenta(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingCuenta(false); return; }
    const { data } = await supabase
      .from('cuentas_ahorro')
      .insert({
        user_id: user.id,
        nombre_cuenta: nuevaCuentaNombre.trim(),
        saldo_actual: parseFloat(nuevaCuentaSaldoInicial) || 0,
      })
      .select('id, nombre_cuenta, saldo_actual')
      .single();
    if (data) {
      setCuentas(prev => [...prev, data]);
      setCuentaId(data.id);
      setNuevaCuentaNombre('');
      setNuevaCuentaSaldoInicial('');
      setShowNuevaCuenta(false);
      setShowCuentaPicker(false);
    }
    setSavingCuenta(false);
  };

  const handleGuardar = async () => {
    setError('');
    if (!cuentaId) { setError('Selecciona una cuenta de ahorro.'); return; }
    const m = parseFloat(monto.replace(',', '.'));
    if (isNaN(m) || m <= 0) { setError('Ingresa un monto válido.'); return; }

    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Sesión no encontrada.'); setLoading(false); return; }

    const { error: dbErr } = await supabase.from('ahorros_inversiones').insert({
      user_id: user.id,
      cuenta_ahorro_id: cuentaId,
      subtipo,
      monto: m,
      descripcion: descripcion.trim() || null,
    });

    if (dbErr) { setError(dbErr.message); setLoading(false); return; }
    router.back();
  };

  // ── Render ────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={[styles.header, { backgroundColor: tab.headerBg }]}>
        <SafeAreaView>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top:10, bottom:10, left:10, right:10 }}>
            <Text style={[styles.back, { color: tab.accent }]}>← Volver</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: tab.accent }]}>🏦 Ahorros / Inversión</Text>
        </SafeAreaView>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {TABS.map(t => {
          const active = subtipo === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.tab, active && { borderBottomColor: t.accent, borderBottomWidth: 2.5 }]}
              onPress={() => { setSubtipo(t.key); setError(''); }}
            >
              <Text style={[styles.tabText, active && { color: t.accent, fontWeight: '700' }]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={styles.form}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Hint */}
        <View style={[styles.hint, { backgroundColor: tab.accent + '15' }]}>
          <Text style={[styles.hintText, { color: tab.accent }]}>{tab.desc}</Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/* Cuenta de Ahorro selector */}
        <Text style={styles.label}>
          Cuenta de {subtipo === 'abono' ? 'destino' : subtipo === 'retiro' ? 'origen' : 'ahorro'}
        </Text>
        {loadingCuentas ? (
          <View style={styles.selectorLoading}>
            <ActivityIndicator size="small" color={tab.accent} />
            <Text style={styles.selectorLoadingText}>Cargando cuentas...</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.selector, cuentaActiva && { height: 62 }]}
            onPress={() => setShowCuentaPicker(true)}
          >
            {cuentaActiva ? (
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.selectorText} numberOfLines={1}>🏦 {cuentaActiva.nombre_cuenta}</Text>
                <Text style={styles.selectorSubtext}>
                  Saldo: {simbolo} {Number(cuentaActiva.saldo_actual).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                </Text>
              </View>
            ) : (
              <Text style={styles.selectorPlaceholder}>
                {cuentas.length === 0 ? 'Crea tu primera cuenta →' : 'Selecciona una cuenta'}
              </Text>
            )}
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        )}

        {/* Monto */}
        <Text style={styles.label}>Monto</Text>
        <View style={styles.montoWrap}>
          <Text style={[styles.montoPrefix, { color: tab.accent }]}>{simbolo}</Text>
          <TextInput
            style={styles.montoInput}
            placeholder="0.00" placeholderTextColor="#9CA3AF"
            keyboardType="decimal-pad" value={monto}
            onChangeText={setMonto} editable={!loading}
          />
        </View>

        {/* Descripcion */}
        <Text style={styles.label}>Descripción <Text style={styles.optional}>(opcional)</Text></Text>
        <TextInput
          style={[styles.input, styles.inputMulti]}
          placeholder="Ej: Ahorro mensual programado, Interés de julio"
          placeholderTextColor="#9CA3AF" value={descripcion}
          onChangeText={setDesc} multiline editable={!loading} textAlignVertical="top"
        />

        <TouchableOpacity
          style={[styles.btn, { backgroundColor: tab.accent }, loading && styles.btnDisabled]}
          onPress={handleGuardar} disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.btnText}>
                {subtipo === 'abono' ? 'Registrar Abono' : subtipo === 'retiro' ? 'Registrar Retiro' : 'Registrar Interés'}
              </Text>
          }
        </TouchableOpacity>
        <View style={{ height: 48 }} />
      </ScrollView>

      {/* ── Cuenta Picker ── */}
      <Modal visible={showCuentaPicker} animationType="slide" transparent>
        <SafeAreaView style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Cuentas de Ahorro</Text>
              <TouchableOpacity onPress={() => setShowCuentaPicker(false)}>
                <Text style={[styles.closeBtn, { color: tab.accent }]}>Cerrar</Text>
              </TouchableOpacity>
            </View>
            {cuentas.length === 0 ? (
              <View style={{ padding: 24, alignItems: 'center' }}>
                <Text style={styles.emptyMsg}>No tienes cuentas de ahorro aún.</Text>
                <Text style={[styles.emptyMsg, { marginTop: 4, marginBottom: 16 }]}>
                  Crea la primera para empezar a ahorrar.
                </Text>
                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: tab.accent, width: '100%' }]}
                  onPress={() => setShowNuevaCuenta(true)}
                >
                  <Text style={styles.btnText}>＋ Crear primera cuenta</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <FlatList
                data={cuentas} keyExtractor={item => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.option}
                    onPress={() => { setCuentaId(item.id); setShowCuentaPicker(false); }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.optionText}>🏦 {item.nombre_cuenta}</Text>
                      <Text style={styles.selectorSubtext}>
                        Saldo: {simbolo} {Number(item.saldo_actual).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                      </Text>
                    </View>
                    {cuentaId === item.id && <Text style={[styles.checkmark, { color: tab.accent }]}>✓</Text>}
                  </TouchableOpacity>
                )}
                ItemSeparatorComponent={() => <View style={styles.sep} />}
                ListFooterComponent={
                  <TouchableOpacity
                    style={[styles.option, { justifyContent: 'center' }]}
                    onPress={() => setShowNuevaCuenta(true)}
                  >
                    <Text style={{ color: tab.accent, fontWeight: '600', fontSize: 15 }}>＋ Nueva cuenta de ahorro</Text>
                  </TouchableOpacity>
                }
              />
            )}

            {/* Inline: nueva cuenta form */}
            {showNuevaCuenta && (
              <View style={styles.nuevoForm}>
                <Text style={styles.nuevoTitle}>Nueva cuenta</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Ej: Fondo de emergencia, Inversiones, Viaje"
                  placeholderTextColor="#9CA3AF"
                  value={nuevaCuentaNombre}
                  onChangeText={setNuevaCuentaNombre}
                  autoFocus
                />
                <Text style={[styles.label, { marginTop: 12 }]}>
                  Saldo Inicial <Text style={styles.optional}>(opcional)</Text>
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="0.00"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="decimal-pad"
                  value={nuevaCuentaSaldoInicial}
                  onChangeText={setNuevaCuentaSaldoInicial}
                />
                <View style={[styles.row, { marginTop: 12 }]}>
                  <TouchableOpacity
                    style={[styles.btnSmall, { borderColor: tab.accent }]}
                    onPress={() => { setShowNuevaCuenta(false); setNuevaCuentaNombre(''); setNuevaCuentaSaldoInicial(''); }}
                  >
                    <Text style={{ color: tab.accent, fontWeight: '600' }}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btnSmall, { backgroundColor: tab.accent, borderColor: tab.accent, marginLeft: 10 },
                      (savingCuenta || !nuevaCuentaNombre.trim()) && styles.btnDisabled]}
                    onPress={handleCrearCuenta}
                    disabled={savingCuenta || !nuevaCuentaNombre.trim()}
                  >
                    {savingCuenta
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={{ color: '#fff', fontWeight: '600' }}>Crear</Text>
                    }
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </SafeAreaView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    paddingHorizontal: 24,
    paddingTop: Platform.select({ ios: 0, android: 32, default: 24 }),
    paddingBottom: 20,
  },
  back:  { fontSize: 15, fontWeight: '500', marginBottom: 8 },
  title: { fontSize: 22, fontWeight: '800' },

  tabs: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  tab:  { flex: 1, paddingVertical: 14, alignItems: 'center', borderBottomWidth: 2.5, borderBottomColor: 'transparent' },
  tabText: { fontSize: 12, textAlign: 'center', color: '#9CA3AF' },

  form: { padding: 24, width: '100%', maxWidth: 600, alignSelf: 'center' },

  hint:     { borderRadius: 10, padding: 12, marginBottom: 4 },
  hintText: { fontSize: 13, lineHeight: 19 },
  error:    { backgroundColor: '#FEE2E2', color: '#DC2626', borderRadius: 10, padding: 12, marginBottom: 8, fontSize: 14, marginTop: 8 },

  label:    { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 8, marginTop: 20 },
  optional: { fontWeight: '400', color: '#9CA3AF' },

  selectorLoading: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 52, paddingHorizontal: 16,
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12 },
  selectorLoadingText: { fontSize: 15, color: '#9CA3AF' },

  selector: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: 12, paddingHorizontal: 16, height: 52, minHeight: 52,
  },
  selectorText:        { fontSize: 15, color: '#111827' },
  selectorSubtext:     { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  selectorPlaceholder: { fontSize: 15, color: '#9CA3AF' },
  chevron:             { fontSize: 20, color: '#9CA3AF', flexShrink: 0 },

  montoWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: 12, paddingHorizontal: 16, height: 58,
  },
  montoPrefix: { fontSize: 20, fontWeight: '700', marginRight: 8 },
  montoInput:  { flex: 1, fontSize: 24, fontWeight: '700', color: '#111827', minWidth: 0 },

  input: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: 12, paddingHorizontal: 16, fontSize: 16, color: '#111827', height: 52,
  },
  inputMulti: { height: 80, paddingTop: 14, paddingBottom: 14 },

  row: { flexDirection: 'row' },

  btn:         { height: 54, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginTop: 32 },
  btnDisabled: { opacity: 0.5 },
  btnText:     { color: '#fff', fontSize: 16, fontWeight: '700' },

  btnSmall: {
    flex: 1, height: 44, borderRadius: 10, justifyContent: 'center', alignItems: 'center',
    borderWidth: 1.5,
  },

  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '75%', paddingBottom: 24,
  },
  sheetHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  sheetTitle: { fontSize: 16, fontWeight: '600', color: '#111827' },
  closeBtn:   { fontSize: 15, fontWeight: '500' },
  option: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  optionText: { fontSize: 15, color: '#111827' },
  checkmark:  { fontSize: 18, fontWeight: '600' },
  sep:        { height: 1, backgroundColor: '#F3F4F6', marginHorizontal: 20 },
  emptyMsg:   { fontSize: 14, color: '#6B7280', textAlign: 'center' },

  nuevoForm: {
    borderTopWidth: 1, borderTopColor: '#F3F4F6',
    padding: 20,
  },
  nuevoTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 12 },
});
