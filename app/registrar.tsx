import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
  Modal, FlatList, SafeAreaView, ScrollView, Switch,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useExchangeRate } from '@/hooks/useExchangeRate';
import { useCategorias, BASE_INCOME_CATS } from '@/hooks/useCategorias';
import { useHogar } from '@/hooks/useHogar';
import { T, R, MAXW } from '@/theme';

// ── Types ─────────────────────────────────────────────────────
type GastoTab   = 'unica' | 'recurrente' | 'cuotas';
type MetodoPago = 'efectivo' | 'tarjeta';

interface Tarjeta {
  id: string;
  banco: string;
  nombre_tarjeta: string;
  linea_credito: number;
  deuda_actual: number;
}

// ── Constants ─────────────────────────────────────────────────
const GASTO_TABS: { key: GastoTab; label: string }[] = [
  { key: 'unica',      label: 'Gasto\nÚnico'      },
  { key: 'recurrente', label: 'Gasto\nRecurrente' },
  { key: 'cuotas',     label: 'Compra en\nCuotas' },
];

const CURRENCY_SYMBOL: Record<string, string> = {
  PEN: 'S/', USD: '$', EUR: '€', BRL: 'R$',
  COP: '$',  MXN: '$', ARS: '$', CLP: '$',
};

// ── Helpers ───────────────────────────────────────────────────
function parseMonto(raw: string) { return parseFloat(raw.replace(',', '.')); }

function parseMes(input: string): string | null {
  if (!/^\d{2}\/\d{4}$/.test(input.trim())) return null;
  const [mm, yyyy] = input.split('/');
  const m = parseInt(mm, 10), y = parseInt(yyyy, 10);
  if (m < 1 || m > 12 || y < 2020 || y > 2100) return null;
  return `${yyyy}-${mm}-01`;
}

function fmtDeuda(simbolo: string, monto: number, linea: number) {
  const d = Number(monto).toLocaleString('es-PE', { minimumFractionDigits: 2 });
  if (linea > 0) {
    const l = Number(linea).toLocaleString('es-PE', { minimumFractionDigits: 2 });
    return `Deuda: ${simbolo} ${d} / ${simbolo} ${l}`;
  }
  return `Deuda actual: ${simbolo} ${d}`;
}

// ── Component ─────────────────────────────────────────────────
export default function Registrar() {
  const { tipo, moneda } = useLocalSearchParams<{ tipo: string; moneda: string }>();
  const esIngreso = tipo === 'ingreso';
  const accent    = esIngreso ? T.green : T.red;
  const headerBg  = esIngreso ? T.greenSoft : T.redSoft;

  // ── Modo hogar
  const { membresia: miMembresia } = useHogar();
  const tieneHogar = miMembresia?.estado === 'activo';
  const [privado, setPrivado] = useState(false);

  // ── Categorías dinámicas desde DB
  const { categorias: catGasto } = useCategorias();

  // ── Multi-moneda
  const { rate } = useExchangeRate();
  // txMoneda: moneda en la que el usuario está ingresando este movimiento
  const [txMoneda, setTxMoneda] = useState<'PEN'|'USD'>('PEN');
  const simbolo = CURRENCY_SYMBOL[txMoneda] ?? 'S/';

  // ── Tab state
  const [gastoTab, setGastoTab] = useState<GastoTab>('unica');

  // ── Shared UI
  const [loading,           setLoading]           = useState(false);
  const [error,             setError]             = useState('');
  const [showPicker,        setShowPicker]        = useState(false);
  const [showSubcatPicker,  setShowSubcatPicker]  = useState(false);
  const [showTarjetaPicker, setShowTarjetaPicker] = useState(false);
  const [showNuevaTarjeta,  setShowNuevaTarjeta]  = useState(false);

  // ── Subcategorías (solo gasto único)
  const [subcatId,       setSubcatId]       = useState<string | null>(null);
  const [subcats,        setSubcats]        = useState<{ id: string; nombre: string }[]>([]);
  const [subcatsLoading, setSubcatsLoading] = useState(false);
  const [savingTarjeta,     setSavingTarjeta]     = useState(false);

  // ── Tarjetas
  const [tarjetas,     setTarjetas]     = useState<Tarjeta[]>([]);
  const [nuevaTarjeta, setNuevaTarjeta] = useState({ banco: '', nombre: '', linea: '', cierre: '', deudaInicial: '' });

  // ── Forms
  const [iU, setIU] = useState({ monto: '', categoria: '', descripcion: '' });
  const [gU, setGU] = useState({ monto: '', categoria: '', descripcion: '', metodoPago: 'efectivo' as MetodoPago, tarjetaId: '' });
  const [gR, setGR] = useState({ monto: '', categoria: '', descripcion: '', diaCobro: '', mesInicio: '', mesFin: '' });
  const [gC, setGC] = useState({ descripcion: '', montoTotal: '', totalCuotas: '', categoria: '', diaCobro: '', mesInicio: '', metodoPago: 'efectivo' as MetodoPago, tarjetaId: '' });

  // ── Load tarjetas (gasto only)
  useEffect(() => {
    if (esIngreso) return;
    let mounted = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !mounted) return;
      const { data } = await supabase
        .from('tarjetas_credito')
        .select('id, banco, nombre_tarjeta, linea_credito, deuda_actual')
        .eq('user_id', user.id)
        .order('creado_en', { ascending: true });
      if (mounted && data) setTarjetas(data);
    })();
    return () => { mounted = false; };
  }, []); // esIngreso is constant for the lifetime of this screen

  // ── Derived
  const pickerCategorias = esIngreso
    ? BASE_INCOME_CATS.map(c => c.nombre)
    : catGasto.map(c => c.nombre);
  const categoriaActual  = esIngreso
    ? iU.categoria
    : gastoTab === 'unica' ? gU.categoria
    : gastoTab === 'recurrente' ? gR.categoria
    : gC.categoria;
  const tarjetaActivaId = gastoTab === 'unica' ? gU.tarjetaId : gC.tarjetaId;
  const tarjetaActiva   = tarjetas.find(t => t.id === tarjetaActivaId);
  const cuotaMensual = (() => {
    const mt = parseMonto(gC.montoTotal);
    const tc = parseInt(gC.totalCuotas, 10);
    if (!isNaN(mt) && mt > 0 && !isNaN(tc) && tc >= 2)
      return Math.round((mt / tc) * 100) / 100;
    return null;
  })();

  // ── Handlers
  const loadSubcats = async (cat: string) => {
    setSubcatId(null);
    setSubcats([]);
    setSubcatsLoading(true);
    const { data } = await supabase
      .from('subcategorias')
      .select('id,nombre')
      .eq('categoria_nombre', cat)
      .order('nombre');
    setSubcats(data ?? []);
    setSubcatsLoading(false);
  };

  const selectCategoria = (cat: string) => {
    if (esIngreso) {
      setIU(s => ({ ...s, categoria: cat }));
    } else if (gastoTab === 'unica') {
      setGU(s => ({ ...s, categoria: cat }));
      loadSubcats(cat);
    } else if (gastoTab === 'recurrente') {
      setGR(s => ({ ...s, categoria: cat }));
    } else {
      setGC(s => ({ ...s, categoria: cat }));
    }
    setShowPicker(false);
  };

  const selectTarjeta = (id: string) => {
    if (gastoTab === 'unica') setGU(s => ({ ...s, tarjetaId: id }));
    else                      setGC(s => ({ ...s, tarjetaId: id }));
    setShowTarjetaPicker(false);
  };

  const handleCrearTarjeta = async () => {
    if (!nuevaTarjeta.banco.trim() || !nuevaTarjeta.nombre.trim()) return;
    setSavingTarjeta(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingTarjeta(false); return; }
    const { data } = await supabase
      .from('tarjetas_credito')
      .insert({
        user_id: user.id,
        banco: nuevaTarjeta.banco.trim(),
        nombre_tarjeta: nuevaTarjeta.nombre.trim(),
        linea_credito: parseFloat(nuevaTarjeta.linea) || 0,
        deuda_actual: parseFloat(nuevaTarjeta.deudaInicial) || 0,
        dia_cierre: parseInt(nuevaTarjeta.cierre) || null,
      })
      .select('id, banco, nombre_tarjeta, linea_credito, deuda_actual')
      .single();
    if (data) {
      setTarjetas(prev => [...prev, data]);
      selectTarjeta(data.id);
      setNuevaTarjeta({ banco: '', nombre: '', linea: '', cierre: '', deudaInicial: '' });
      setShowNuevaTarjeta(false);
    }
    setSavingTarjeta(false);
  };

  const handleGuardar = async () => {
    setError('');
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Sesión no encontrada.'); setLoading(false); return; }

    let dbError: { message: string } | null = null;

    const tcHoy = rate.venta; // tasa venta PEN/USD del día

    if (esIngreso) {
      const m = parseMonto(iU.monto);
      if (isNaN(m) || m <= 0) { setError('Ingresa un monto válido.'); setLoading(false); return; }
      if (!iU.categoria)       { setError('Selecciona una categoría.'); setLoading(false); return; }
      const { error: e } = await supabase.from('transacciones').insert({
        user_id: user.id, tipo: 'ingreso', monto: m,
        categoria: iU.categoria, descripcion: iU.descripcion.trim() || null,
        moneda: txMoneda, tipo_cambio: txMoneda === 'USD' ? tcHoy : 1.0,
      });
      dbError = e;

    } else if (gastoTab === 'unica') {
      const m = parseMonto(gU.monto);
      if (isNaN(m) || m <= 0)                           { setError('Ingresa un monto válido.'); setLoading(false); return; }
      if (!gU.categoria)                                 { setError('Selecciona una categoría.'); setLoading(false); return; }
      if (gU.metodoPago === 'tarjeta' && !gU.tarjetaId) { setError('Selecciona una tarjeta de crédito.'); setLoading(false); return; }
      const { error: e } = await supabase.from('transacciones').insert({
        user_id: user.id, tipo: 'gasto', monto: m,
        categoria: gU.categoria, descripcion: gU.descripcion.trim() || null,
        metodo_pago: gU.metodoPago,
        tarjeta_id: gU.metodoPago === 'tarjeta' ? gU.tarjetaId : null,
        subcategoria_id: subcatId ?? null,
        moneda: txMoneda, tipo_cambio: txMoneda === 'USD' ? tcHoy : 1.0,
        privado: tieneHogar ? privado : false,
      });
      dbError = e;

    } else if (gastoTab === 'recurrente') {
      const m  = parseMonto(gR.monto);
      const dc = parseInt(gR.diaCobro, 10);
      const mi = parseMes(gR.mesInicio);
      const mf = gR.mesFin.trim() ? parseMes(gR.mesFin) : null;
      if (isNaN(m) || m <= 0)             { setError('Ingresa un monto válido.'); setLoading(false); return; }
      if (!gR.categoria)                   { setError('Selecciona una categoría.'); setLoading(false); return; }
      if (isNaN(dc) || dc < 1 || dc > 31) { setError('El día de cobro debe ser entre 1 y 31.'); setLoading(false); return; }
      if (!mi)                             { setError('Mes de inicio inválido. Usa MM/AAAA.'); setLoading(false); return; }
      if (gR.mesFin.trim() && !mf)         { setError('Mes de fin inválido. Usa MM/AAAA.'); setLoading(false); return; }
      const { error: e } = await supabase.from('gastos_recurrentes').insert({
        user_id: user.id, monto: m, categoria: gR.categoria,
        descripcion: gR.descripcion.trim() || null,
        dia_cobro: dc, mes_inicio: mi, mes_fin: mf,
      });
      dbError = e;

    } else {
      const mt = parseMonto(gC.montoTotal);
      const tc = parseInt(gC.totalCuotas, 10);
      const dc = parseInt(gC.diaCobro, 10);
      const mi = parseMes(gC.mesInicio);
      if (!gC.descripcion.trim())                        { setError('Ingresa una descripción.'); setLoading(false); return; }
      if (isNaN(mt) || mt <= 0)                          { setError('Ingresa un monto total válido.'); setLoading(false); return; }
      if (isNaN(tc) || tc < 2)                           { setError('El número de cuotas debe ser 2 o más.'); setLoading(false); return; }
      if (!gC.categoria)                                  { setError('Selecciona una categoría.'); setLoading(false); return; }
      if (isNaN(dc) || dc < 1 || dc > 31)               { setError('El día de cobro debe ser entre 1 y 31.'); setLoading(false); return; }
      if (!mi)                                            { setError('Mes de inicio inválido. Usa MM/AAAA.'); setLoading(false); return; }
      if (gC.metodoPago === 'tarjeta' && !gC.tarjetaId) { setError('Selecciona una tarjeta de crédito.'); setLoading(false); return; }
      const { error: e } = await supabase.from('compras_cuotas').insert({
        user_id: user.id, descripcion: gC.descripcion.trim(), categoria: gC.categoria,
        monto_total: mt, total_cuotas: tc,
        monto_cuota: Math.round((mt / tc) * 100) / 100,
        dia_cobro: dc, mes_inicio: mi,
        metodo_pago: gC.metodoPago,
        tarjeta_id: gC.metodoPago === 'tarjeta' ? gC.tarjetaId : null,
      });
      dbError = e;
    }

    if (dbError) { setError(dbError.message); setLoading(false); return; }
    router.back();
  };

  // ── Sub-components ────────────────────────────────────────
  const MetodoPagoToggle = ({ metodoPago, onEfectivo, onTarjeta }: {
    metodoPago: MetodoPago;
    onEfectivo: () => void;
    onTarjeta: () => void;
  }) => (
    <View style={styles.toggle}>
      <TouchableOpacity
        style={[styles.toggleBtn, metodoPago === 'efectivo' && styles.toggleActive]}
        onPress={onEfectivo}
      >
        <Text style={[styles.toggleText, metodoPago === 'efectivo' && { color: accent, fontWeight: '700' }]}>
          💵  Efectivo
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.toggleBtn, metodoPago === 'tarjeta' && styles.toggleActive]}
        onPress={onTarjeta}
      >
        <Text style={[styles.toggleText, metodoPago === 'tarjeta' && { color: accent, fontWeight: '700' }]}>
          💳  Tarjeta
        </Text>
      </TouchableOpacity>
    </View>
  );

  const TarjetaSelector = () => (
    <>
      <Text style={styles.label}>Tarjeta a cargar</Text>
      <TouchableOpacity style={[styles.selector, { height: tarjetaActiva ? 62 : 52 }]}
        onPress={() => setShowTarjetaPicker(true)} disabled={loading}>
        {tarjetaActiva ? (
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.selectorText} numberOfLines={1}>
              💳 {tarjetaActiva.banco} — {tarjetaActiva.nombre_tarjeta}
            </Text>
            <Text style={styles.selectorSubtext}>
              {fmtDeuda(simbolo, tarjetaActiva.deuda_actual, tarjetaActiva.linea_credito)}
            </Text>
          </View>
        ) : (
          <Text style={styles.selectorPlaceholder}>Selecciona una tarjeta</Text>
        )}
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>
    </>
  );

  // ── Render ────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={[styles.header, { backgroundColor: headerBg }]}>
        <SafeAreaView>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={[styles.backText, { color: accent }]}>← Volver</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: accent }]}>
            {esIngreso ? '＋ Registrar Ingreso' : '－ Registrar Gasto'}
          </Text>
        </SafeAreaView>
      </View>

      {/* Tabs — gasto only */}
      {!esIngreso && (
        <View style={styles.tabs}>
          {GASTO_TABS.map(tab => {
            const active = gastoTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                style={[styles.tab, active && { borderBottomColor: accent, borderBottomWidth: 2.5 }]}
                onPress={() => { setGastoTab(tab.key); setError(''); }}
              >
                <Text style={[styles.tabText, active && { color: accent, fontWeight: '700' }]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Form */}
      <ScrollView
        contentContainerStyle={styles.form}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Selector de moneda */}
        <View style={styles.currencyRow}>
          <Text style={styles.currencyLabel}>Moneda</Text>
          <View style={styles.currencyToggle}>
            {(['PEN', 'USD'] as const).map(cur => (
              <TouchableOpacity
                key={cur}
                style={[styles.currencyBtn, txMoneda === cur && { backgroundColor: accent }]}
                onPress={() => setTxMoneda(cur)}
              >
                <Text style={[styles.currencyBtnText, txMoneda === cur && { color: '#fff' }]}>
                  {cur === 'PEN' ? 'S/ PEN' : '$ USD'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {txMoneda === 'USD' && (
            <Text style={styles.rateHint}>T.C. venta: S/ {rate.venta.toFixed(3)}</Text>
          )}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/* ── Ingreso Único ── */}
        {esIngreso && (
          <>
            <Text style={styles.label}>Monto</Text>
            <View style={styles.montoWrap}>
              <Text style={[styles.montoPrefix, { color: accent }]}>{simbolo}</Text>
              <TextInput style={styles.montoInput} placeholder="0.00" placeholderTextColor={T.textMicro}
                keyboardType="decimal-pad" value={iU.monto}
                onChangeText={v => setIU(s => ({ ...s, monto: v }))}
                editable={!loading} autoFocus />
            </View>
            <Text style={styles.label}>Categoría</Text>
            <TouchableOpacity style={styles.selector} onPress={() => setShowPicker(true)} disabled={loading}>
              <Text style={iU.categoria ? styles.selectorText : styles.selectorPlaceholder}>
                {iU.categoria || 'Selecciona una categoría'}
              </Text>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
            <Text style={styles.label}>Descripción <Text style={styles.optional}>(opcional)</Text></Text>
            <TextInput style={[styles.input, styles.inputMulti]} placeholder="Ej: Sueldo de julio"
              placeholderTextColor={T.textMicro} value={iU.descripcion}
              onChangeText={v => setIU(s => ({ ...s, descripcion: v }))}
              multiline editable={!loading} textAlignVertical="top" />
          </>
        )}

        {/* ── Gasto Único ── */}
        {!esIngreso && gastoTab === 'unica' && (
          <>
            <Text style={styles.label}>Monto</Text>
            <View style={styles.montoWrap}>
              <Text style={[styles.montoPrefix, { color: accent }]}>{simbolo}</Text>
              <TextInput style={styles.montoInput} placeholder="0.00" placeholderTextColor={T.textMicro}
                keyboardType="decimal-pad" value={gU.monto}
                onChangeText={v => setGU(s => ({ ...s, monto: v }))}
                editable={!loading} autoFocus />
            </View>
            <Text style={styles.label}>Categoría</Text>
            <TouchableOpacity style={styles.selector} onPress={() => setShowPicker(true)} disabled={loading}>
              <Text style={gU.categoria ? styles.selectorText : styles.selectorPlaceholder}>
                {gU.categoria || 'Selecciona una categoría'}
              </Text>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
            {gU.categoria !== '' && (
              <>
                <Text style={styles.label}>Subcategoría <Text style={styles.optional}>(opcional)</Text></Text>
                {subcatsLoading ? (
                  <ActivityIndicator color={accent} style={{ marginVertical: 8, alignSelf: 'flex-start' }} />
                ) : subcats.length > 0 ? (
                  <TouchableOpacity style={styles.selector} onPress={() => setShowSubcatPicker(true)} disabled={loading}>
                    <Text style={subcatId ? styles.selectorText : styles.selectorPlaceholder}>
                      {subcats.find(s => s.id === subcatId)?.nombre ?? 'Sin subcategoría'}
                    </Text>
                    <Text style={styles.chevron}>›</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={[styles.hint, { marginTop: 0 }]}>
                    <Text style={styles.hintText}>Sin subcategorías para esta categoría.</Text>
                  </View>
                )}
              </>
            )}
            <Text style={styles.label}>Método de pago</Text>
            <MetodoPagoToggle
              metodoPago={gU.metodoPago}
              onEfectivo={() => setGU(s => ({ ...s, metodoPago: 'efectivo', tarjetaId: '' }))}
              onTarjeta={() => setGU(s => ({ ...s, metodoPago: 'tarjeta' }))}
            />
            {gU.metodoPago === 'tarjeta' && <TarjetaSelector />}
            <Text style={styles.label}>Descripción <Text style={styles.optional}>(opcional)</Text></Text>
            <TextInput style={[styles.input, styles.inputMulti]} placeholder="Ej: Supermercado del lunes"
              placeholderTextColor={T.textMicro} value={gU.descripcion}
              onChangeText={v => setGU(s => ({ ...s, descripcion: v }))}
              multiline editable={!loading} textAlignVertical="top" />
            {tieneHogar && (
              <View style={styles.privadoRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.privadoLabel}>🔒 Privado</Text>
                  <Text style={styles.privadoSub}>No visible para el resto del hogar</Text>
                </View>
                <Switch
                  value={privado}
                  onValueChange={setPrivado}
                  trackColor={{ false: T.inputBorder, true: T.accentSoft }}
                  thumbColor={privado ? T.accent : T.textMicro}
                />
              </View>
            )}
          </>
        )}

        {/* ── Gasto Recurrente ── */}
        {!esIngreso && gastoTab === 'recurrente' && (
          <>
            <View style={styles.hint}>
              <Text style={styles.hintText}>Cobra cada mes en una fecha fija: suscripciones, servicios, membresías.</Text>
            </View>
            <Text style={styles.label}>Monto mensual</Text>
            <View style={styles.montoWrap}>
              <Text style={[styles.montoPrefix, { color: accent }]}>{simbolo}</Text>
              <TextInput style={styles.montoInput} placeholder="0.00" placeholderTextColor={T.textMicro}
                keyboardType="decimal-pad" value={gR.monto}
                onChangeText={v => setGR(s => ({ ...s, monto: v }))}
                editable={!loading} autoFocus />
            </View>
            <Text style={styles.label}>Categoría</Text>
            <TouchableOpacity style={styles.selector} onPress={() => setShowPicker(true)} disabled={loading}>
              <Text style={gR.categoria ? styles.selectorText : styles.selectorPlaceholder}>
                {gR.categoria || 'Selecciona una categoría'}
              </Text>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
            <Text style={styles.label}>Descripción <Text style={styles.optional}>(opcional)</Text></Text>
            <TextInput style={[styles.input, styles.inputMulti]} placeholder="Ej: Netflix, Gym, Internet"
              placeholderTextColor={T.textMicro} value={gR.descripcion}
              onChangeText={v => setGR(s => ({ ...s, descripcion: v }))}
              multiline editable={!loading} textAlignVertical="top" />
            <View style={styles.row}>
              <View style={styles.col}>
                <Text style={styles.label}>Día de cobro</Text>
                <TextInput style={styles.input} placeholder="15" placeholderTextColor={T.textMicro}
                  keyboardType="number-pad" value={gR.diaCobro}
                  onChangeText={v => setGR(s => ({ ...s, diaCobro: v }))}
                  editable={!loading} maxLength={2} />
              </View>
              <View style={[styles.col, { marginLeft: 12 }]}>
                <Text style={styles.label}>Mes de inicio</Text>
                <TextInput style={styles.input} placeholder="06/2026" placeholderTextColor={T.textMicro}
                  keyboardType="numbers-and-punctuation" value={gR.mesInicio}
                  onChangeText={v => setGR(s => ({ ...s, mesInicio: v }))}
                  editable={!loading} maxLength={7} />
              </View>
            </View>
            <Text style={styles.label}>Mes de fin <Text style={styles.optional}>(opcional)</Text></Text>
            <TextInput style={styles.input} placeholder="12/2026" placeholderTextColor={T.textMicro}
              keyboardType="numbers-and-punctuation" value={gR.mesFin}
              onChangeText={v => setGR(s => ({ ...s, mesFin: v }))}
              editable={!loading} maxLength={7} />
          </>
        )}

        {/* ── Compra en Cuotas ── */}
        {!esIngreso && gastoTab === 'cuotas' && (
          <>
            <View style={styles.hint}>
              <Text style={styles.hintText}>Compra dividida en pagos mensuales: electrodomésticos, tecnología, muebles.</Text>
            </View>
            <Text style={styles.label}>Descripción</Text>
            <TextInput style={styles.input} placeholder="Ej: Laptop HP, Refrigeradora Samsung"
              placeholderTextColor={T.textMicro} value={gC.descripcion}
              onChangeText={v => setGC(s => ({ ...s, descripcion: v }))}
              editable={!loading} autoFocus />
            <View style={styles.row}>
              <View style={styles.col}>
                <Text style={styles.label}>Monto total</Text>
                <View style={styles.montoWrap}>
                  <Text style={[styles.montoPrefix, { color: accent }]}>{simbolo}</Text>
                  <TextInput style={styles.montoInput} placeholder="0.00" placeholderTextColor={T.textMicro}
                    keyboardType="decimal-pad" value={gC.montoTotal}
                    onChangeText={v => setGC(s => ({ ...s, montoTotal: v }))} editable={!loading} />
                </View>
              </View>
              <View style={[styles.col, { marginLeft: 12 }]}>
                <Text style={styles.label}>N° cuotas</Text>
                <TextInput style={[styles.input, { fontSize: 20, fontWeight: '700' }]}
                  placeholder="12" placeholderTextColor={T.textMicro}
                  keyboardType="number-pad" value={gC.totalCuotas}
                  onChangeText={v => setGC(s => ({ ...s, totalCuotas: v }))}
                  editable={!loading} maxLength={3} />
              </View>
            </View>
            {cuotaMensual !== null && (
              <View style={styles.cuotaPreview}>
                <Text style={styles.cuotaLabel}>Cuota mensual estimada</Text>
                <Text style={[styles.cuotaValue, { color: accent }]}>
                  {simbolo} {cuotaMensual.toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                </Text>
              </View>
            )}
            <Text style={styles.label}>Categoría</Text>
            <TouchableOpacity style={styles.selector} onPress={() => setShowPicker(true)} disabled={loading}>
              <Text style={gC.categoria ? styles.selectorText : styles.selectorPlaceholder}>
                {gC.categoria || 'Selecciona una categoría'}
              </Text>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
            <Text style={styles.label}>Método de pago</Text>
            <MetodoPagoToggle
              metodoPago={gC.metodoPago}
              onEfectivo={() => setGC(s => ({ ...s, metodoPago: 'efectivo', tarjetaId: '' }))}
              onTarjeta={() => setGC(s => ({ ...s, metodoPago: 'tarjeta' }))}
            />
            {gC.metodoPago === 'tarjeta' && <TarjetaSelector />}
            <View style={styles.row}>
              <View style={styles.col}>
                <Text style={styles.label}>Día de cobro</Text>
                <TextInput style={styles.input} placeholder="15" placeholderTextColor={T.textMicro}
                  keyboardType="number-pad" value={gC.diaCobro}
                  onChangeText={v => setGC(s => ({ ...s, diaCobro: v }))}
                  editable={!loading} maxLength={2} />
              </View>
              <View style={[styles.col, { marginLeft: 12 }]}>
                <Text style={styles.label}>Mes de inicio</Text>
                <TextInput style={styles.input} placeholder="06/2026" placeholderTextColor={T.textMicro}
                  keyboardType="numbers-and-punctuation" value={gC.mesInicio}
                  onChangeText={v => setGC(s => ({ ...s, mesInicio: v }))}
                  editable={!loading} maxLength={7} />
              </View>
            </View>
          </>
        )}

        <TouchableOpacity
          style={[styles.btn, { backgroundColor: accent }, loading && styles.btnDisabled]}
          onPress={handleGuardar} disabled={loading}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Guardar</Text>}
        </TouchableOpacity>
        <View style={{ height: 48 }} />
      </ScrollView>

      {/* ── Subcategory Picker ── */}
      <Modal visible={showSubcatPicker} animationType="slide" transparent>
        <SafeAreaView style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Selecciona una subcategoría</Text>
              <TouchableOpacity onPress={() => setShowSubcatPicker(false)}>
                <Text style={[styles.closeBtn, { color: accent }]}>Cerrar</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={[{ id: null as string | null, nombre: 'Sin subcategoría' }, ...subcats]}
              keyExtractor={(item, i) => item.id ?? `none-${i}`}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.option}
                  onPress={() => { setSubcatId(item.id); setShowSubcatPicker(false); }}
                >
                  <Text style={styles.optionText}>{item.nombre}</Text>
                  {subcatId === item.id && <Text style={[styles.checkmark, { color: accent }]}>✓</Text>}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.sep} />}
            />
          </View>
        </SafeAreaView>
      </Modal>

      {/* ── Category Picker ── */}
      <Modal visible={showPicker} animationType="slide" transparent>
        <SafeAreaView style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Selecciona una categoría</Text>
              <TouchableOpacity onPress={() => setShowPicker(false)}>
                <Text style={[styles.closeBtn, { color: accent }]}>Cerrar</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={pickerCategorias} keyExtractor={item => item}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.option} onPress={() => selectCategoria(item)}>
                  <Text style={styles.optionText}>{item}</Text>
                  {categoriaActual === item && <Text style={[styles.checkmark, { color: accent }]}>✓</Text>}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.sep} />}
            />
          </View>
        </SafeAreaView>
      </Modal>

      {/* ── Tarjeta Picker ── */}
      <Modal visible={showTarjetaPicker} animationType="slide" transparent>
        <SafeAreaView style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Selecciona una tarjeta</Text>
              <TouchableOpacity onPress={() => setShowTarjetaPicker(false)}>
                <Text style={[styles.closeBtn, { color: accent }]}>Cerrar</Text>
              </TouchableOpacity>
            </View>
            {tarjetas.length === 0 ? (
              <View style={{ padding: 24, alignItems: 'center' }}>
                <Text style={styles.emptyMsg}>No tienes tarjetas registradas aún.</Text>
                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: accent, width: '100%', marginTop: 12 }]}
                  onPress={() => { setShowTarjetaPicker(false); setShowNuevaTarjeta(true); }}
                >
                  <Text style={styles.btnText}>＋ Agregar tarjeta</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <FlatList
                data={tarjetas} keyExtractor={item => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.option} onPress={() => selectTarjeta(item.id)}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.optionText} numberOfLines={1}>
                        💳 {item.banco} — {item.nombre_tarjeta}
                      </Text>
                      <Text style={styles.selectorSubtext}>
                        {fmtDeuda(simbolo, item.deuda_actual, item.linea_credito)}
                      </Text>
                    </View>
                    {tarjetaActivaId === item.id && <Text style={[styles.checkmark, { color: accent }]}>✓</Text>}
                  </TouchableOpacity>
                )}
                ItemSeparatorComponent={() => <View style={styles.sep} />}
                ListFooterComponent={
                  <TouchableOpacity
                    style={[styles.option, { justifyContent: 'center' }]}
                    onPress={() => { setShowTarjetaPicker(false); setShowNuevaTarjeta(true); }}
                  >
                    <Text style={{ color: accent, fontWeight: '600', fontSize: 15 }}>＋ Agregar nueva tarjeta</Text>
                  </TouchableOpacity>
                }
              />
            )}
          </View>
        </SafeAreaView>
      </Modal>

      {/* ── Nueva Tarjeta ── */}
      <Modal visible={showNuevaTarjeta} animationType="slide" transparent>
        <SafeAreaView style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Nueva Tarjeta de Crédito</Text>
              <TouchableOpacity onPress={() => setShowNuevaTarjeta(false)}>
                <Text style={[styles.closeBtn, { color: accent }]}>Cancelar</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>Banco <Text style={styles.required}>*</Text></Text>
              <TextInput style={styles.input} placeholder="Ej: BCP, BBVA, Scotiabank"
                placeholderTextColor={T.textMicro} value={nuevaTarjeta.banco}
                onChangeText={v => setNuevaTarjeta(s => ({ ...s, banco: v }))} autoFocus />
              <Text style={[styles.label, { marginTop: 16 }]}>Nombre de la tarjeta <Text style={styles.required}>*</Text></Text>
              <TextInput style={styles.input} placeholder="Ej: Visa Clásica, Mastercard Oro"
                placeholderTextColor={T.textMicro} value={nuevaTarjeta.nombre}
                onChangeText={v => setNuevaTarjeta(s => ({ ...s, nombre: v }))} />
              <View style={styles.row}>
                <View style={styles.col}>
                  <Text style={[styles.label, { marginTop: 16 }]}>Línea de crédito <Text style={styles.optional}>(opcional)</Text></Text>
                  <TextInput style={styles.input} placeholder="5000" placeholderTextColor={T.textMicro}
                    keyboardType="decimal-pad" value={nuevaTarjeta.linea}
                    onChangeText={v => setNuevaTarjeta(s => ({ ...s, linea: v }))} />
                </View>
                <View style={[styles.col, { marginLeft: 12 }]}>
                  <Text style={[styles.label, { marginTop: 16 }]}>Día de cierre <Text style={styles.optional}>(opcional)</Text></Text>
                  <TextInput style={styles.input} placeholder="15" placeholderTextColor={T.textMicro}
                    keyboardType="number-pad" maxLength={2} value={nuevaTarjeta.cierre}
                    onChangeText={v => setNuevaTarjeta(s => ({ ...s, cierre: v }))} />
                </View>
              </View>
              <Text style={[styles.label, { marginTop: 16 }]}>Deuda Vigente Inicial <Text style={styles.optional}>(opcional)</Text></Text>
              <TextInput style={styles.input} placeholder="0.00" placeholderTextColor={T.textMicro}
                keyboardType="decimal-pad" value={nuevaTarjeta.deudaInicial}
                onChangeText={v => setNuevaTarjeta(s => ({ ...s, deudaInicial: v }))} />
              {(() => {
                const linea = parseFloat(nuevaTarjeta.linea) || 0;
                const deuda = parseFloat(nuevaTarjeta.deudaInicial) || 0;
                if (linea <= 0) return null;
                const disponible = Math.max(0, linea - deuda);
                return (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between',
                    backgroundColor: T.greenSoft, borderRadius: 10, padding: 12, marginTop: 8 }}>
                    <Text style={{ fontSize: 13, color: T.textSec }}>Saldo Disponible</Text>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: T.green }}>
                      {simbolo} {disponible.toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                    </Text>
                  </View>
                );
              })()}
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: accent, marginTop: 24 },
                  (savingTarjeta || !nuevaTarjeta.banco.trim() || !nuevaTarjeta.nombre.trim()) && styles.btnDisabled]}
                onPress={handleCrearTarjeta}
                disabled={savingTarjeta || !nuevaTarjeta.banco.trim() || !nuevaTarjeta.nombre.trim()}
              >
                {savingTarjeta ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Crear Tarjeta</Text>}
              </TouchableOpacity>
              <View style={{ height: 40 }} />
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.screen },
  header: {
    paddingHorizontal: 24,
    paddingTop: Platform.select({ ios: 0, android: 32, default: 24 }),
    paddingBottom: 20,
  },
  backText: { fontSize: 15, fontWeight: '500', marginBottom: 8 },
  title:    { fontSize: 22, fontWeight: '800' },

  tabs: { flexDirection: 'row', backgroundColor: T.card, borderBottomWidth: 1, borderBottomColor: T.border },
  tab:  { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2.5, borderBottomColor: 'transparent' },
  tabText: { fontSize: 12, textAlign: 'center', color: T.textMicro, lineHeight: 17 },

  form: { padding: 24, width: '100%', maxWidth: MAXW, alignSelf: 'center' },

  error: { backgroundColor: T.redSoft, color: T.red, borderRadius: 10, padding: 12, marginBottom: 8, fontSize: 14 },
  hint:  { backgroundColor: T.screen, borderRadius: 10, padding: 12, marginTop: 8, marginBottom: 4 },
  hintText: { fontSize: 13, color: T.textSec, lineHeight: 19 },

  label:    { fontSize: 13, fontWeight: '600', color: T.textSec, marginBottom: 8, marginTop: 20 },
  optional: { fontWeight: '400', color: T.textMicro },
  required: { color: T.red },

  toggle: {
    flexDirection: 'row', borderRadius: R.control, borderWidth: 1,
    borderColor: T.inputBorder, overflow: 'hidden', backgroundColor: T.card,
  },
  toggleBtn:    { flex: 1, paddingVertical: 13, alignItems: 'center' },
  toggleActive: { backgroundColor: T.redSoft },
  toggleText:   { fontSize: 14, fontWeight: '500', color: T.textSec },

  montoWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: T.input, borderWidth: 1, borderColor: T.inputBorder,
    borderRadius: R.control, paddingHorizontal: 16, height: 58,
  },
  montoPrefix: { fontSize: 20, fontWeight: '700', marginRight: 8 },
  montoInput:  { flex: 1, fontSize: 24, fontWeight: '700', color: T.textPrimary, minWidth: 0 },

  selector: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: T.input, borderWidth: 1, borderColor: T.inputBorder,
    borderRadius: R.control, paddingHorizontal: 16, height: 52, minHeight: 52,
  },
  selectorText:        { fontSize: 15, color: T.textPrimary, flexShrink: 1 },
  selectorSubtext:     { fontSize: 12, color: T.textMicro, marginTop: 2 },
  selectorPlaceholder: { fontSize: 15, color: T.textMicro },
  chevron:             { fontSize: 20, color: T.textMicro, flexShrink: 0 },

  input: {
    backgroundColor: T.input, borderWidth: 1, borderColor: T.inputBorder,
    borderRadius: R.control, paddingHorizontal: 16, fontSize: 16, color: T.textPrimary, height: 52,
  },
  inputMulti: { height: 80, paddingTop: 14, paddingBottom: 14, textAlignVertical: 'top' },

  row: { flexDirection: 'row' },
  col: { flex: 1 },

  cuotaPreview: {
    marginTop: 12, borderRadius: R.control, padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: T.redSoft,
  },
  cuotaLabel: { fontSize: 13, color: T.textSec, fontWeight: '500' },
  cuotaValue: { fontSize: 20, fontWeight: '800' },

  btn:         { height: 54, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginTop: 32 },
  btnDisabled: { opacity: 0.5 },
  btnText:     { color: '#fff', fontSize: 16, fontWeight: '700' },

  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: T.card, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '70%', paddingBottom: 24,
  },
  sheetHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: T.border,
  },
  sheetTitle: { fontSize: 16, fontWeight: '600', color: T.textPrimary },
  closeBtn:   { fontSize: 15, fontWeight: '500' },
  option: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  optionText: { fontSize: 15, color: T.textPrimary },
  checkmark:  { fontSize: 18, fontWeight: '600' },
  sep:        { height: 1, backgroundColor: T.border, marginHorizontal: 20 },
  emptyMsg:   { fontSize: 14, color: T.textSec, textAlign: 'center' },

  // Multi-moneda
  currencyRow:    { flexDirection:'row', alignItems:'center', gap:10, marginBottom:8, flexWrap:'wrap' },
  currencyLabel:  { fontSize:13, fontWeight:'600', color:T.textSec },
  currencyToggle: { flexDirection:'row', backgroundColor:T.screen, borderRadius:10, padding:3, gap:0 },
  currencyBtn:    { paddingHorizontal:14, paddingVertical:7, borderRadius:8 },
  currencyBtnText:{ fontSize:13, fontWeight:'600', color:T.textSec },
  rateHint:       { fontSize:11, color:T.textMicro, fontStyle:'italic' },

  // Privado (Modo Hogar)
  privadoRow:   { flexDirection:'row', alignItems:'center', marginTop:14, padding:12, backgroundColor:T.input, borderRadius:R.control, borderWidth:1, borderColor:T.inputBorder },
  privadoLabel: { fontSize:14, fontWeight:'600', color:T.textPrimary },
  privadoSub:   { fontSize:12, color:T.textMicro, marginTop:2 },
});
