import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
  Animated, Modal, FlatList, SafeAreaView, ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 'welcome' | 'profile' | 'ingreso' | 'presupuestos' | 'wow_input' | 'wow_impact';

// Categorías incluidas en el flujo WOW (regla 50/30/20 adaptada)
const BUDGET_RULES: { cat: string; pct: number; icon: string }[] = [
  { cat: 'Alimentación',    pct: 0.20, icon: '🛒' },
  { cat: 'Transporte',      pct: 0.10, icon: '🚗' },
  { cat: 'Entretenimiento', pct: 0.15, icon: '🎬' },
];

const CURRENCIES = [
  { code: 'PEN', label: 'Sol peruano' },
  { code: 'USD', label: 'Dólar estadounidense' },
  { code: 'EUR', label: 'Euro' },
  { code: 'COP', label: 'Peso colombiano' },
  { code: 'MXN', label: 'Peso mexicano' },
  { code: 'ARS', label: 'Peso argentino' },
  { code: 'BRL', label: 'Real brasileño' },
  { code: 'CLP', label: 'Peso chileno' },
];

const SYM: Record<string, string> = {
  PEN: 'S/', USD: '$', EUR: '€', BRL: 'R$',
  COP: '$', MXN: '$', ARS: '$', CLP: '$',
};

// ─── Animated Impact Banner ───────────────────────────────────────────────────

function ImpactBanner({
  item, amount, budgetAmt, currency,
}: {
  item: string; amount: number; budgetAmt: number; currency: string;
}) {
  const slideY  = useRef(new Animated.Value(40)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const barW    = useRef(new Animated.Value(0)).current;

  const used      = Math.min(amount, budgetAmt);
  const pct       = budgetAmt > 0 ? Math.round((used / budgetAmt) * 100) : 0;
  const remaining = Math.max(budgetAmt - amount, 0);
  const sym       = SYM[currency] ?? currency;
  const barColor  = pct >= 90 ? '#DC2626' : pct >= 70 ? '#F59E0B' : '#22C55E';

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(slideY,  { toValue: 0, duration: 450, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 450, useNativeDriver: true }),
      ]),
      Animated.delay(150),
      Animated.timing(barW, { toValue: pct / 100, duration: 700, useNativeDriver: false }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[styles.bannerCard, { opacity, transform: [{ translateY: slideY }] }]}>
      <Text style={styles.bannerEmoji}>🎯</Text>
      <Text style={styles.bannerTitle}>¡Impacto calculado!</Text>
      <Text style={styles.bannerText}>
        Al registrar{' '}
        <Text style={styles.bold}>{item}</Text> de{' '}
        <Text style={styles.bold}>{sym} {amount.toFixed(2)}</Text>, te queda el{' '}
        <Text style={[styles.bold, { color: barColor }]}>{100 - pct}%</Text> de tu presupuesto
        de Alimentación.{'\n\n'}
        <Text style={[styles.bold, { color: '#22C55E' }]}>
          {sym} {remaining.toFixed(2)} restantes
        </Text>{' '}
        de los{' '}
        <Text style={styles.bold}>{sym} {budgetAmt.toFixed(2)}</Text> que definiste.
        {'\n'}¡Dale seguimiento real desde tu Dashboard!
      </Text>

      <View style={styles.barBg}>
        <Animated.View style={[styles.barFill, {
          backgroundColor: barColor,
          width: barW.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
        }]} />
      </View>
      <View style={styles.barLabels}>
        <Text style={styles.barLbl}>{sym} 0</Text>
        <Text style={[styles.barLbl, { color: barColor, fontWeight: '700' }]}>{pct}% usado</Text>
        <Text style={styles.barLbl}>{sym} {budgetAmt.toFixed(0)}</Text>
      </View>
    </Animated.View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Onboarding() {
  const [step, setStep] = useState<Step>('welcome');

  // Profile
  const [nombre,     setNombre]     = useState('');
  const [apellido,   setApellido]   = useState('');
  const [moneda,     setMoneda]     = useState('PEN');
  const [showPicker, setShowPicker] = useState(false);

  // Ingreso
  const [ingreso, setIngreso] = useState('');

  // Presupuestos (valores editables calculados de la regla 50/30/20)
  const [budgets, setBudgets] = useState<Record<string, string>>({});

  // Wow
  const [wowItem,   setWowItem]   = useState('');
  const [wowAmount, setWowAmount] = useState('');

  // UI
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [userId,  setUserId]  = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id ?? null));
  }, []);

  const sym              = SYM[moneda] ?? moneda;
  const selectedCurrency = CURRENCIES.find(c => c.code === moneda)!;

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleProfileNext = async () => {
    if (!nombre.trim() || !apellido.trim()) { setError('Ingresa tu nombre y apellido.'); return; }
    if (!userId) { setError('Sesión no encontrada. Vuelve a iniciar sesión.'); return; }
    setError('');
    setLoading(true);
    const { error } = await supabase.from('profiles')
      .update({ nombre: nombre.trim(), apellido: apellido.trim(), moneda_base: moneda })
      .eq('id', userId);
    setLoading(false);
    if (error) { setError(error.message); return; }
    setStep('ingreso');
  };

  const handleIngresoNext = () => {
    const val = parseFloat(ingreso.replace(',', '.'));
    if (isNaN(val) || val <= 0) { setError('Ingresa un ingreso válido mayor a 0.'); return; }
    setError('');
    // Pre-calcular presupuestos con regla 50/30/20
    const initial: Record<string, string> = {};
    BUDGET_RULES.forEach(r => {
      initial[r.cat] = (Math.round(val * r.pct * 100) / 100).toFixed(2);
    });
    setBudgets(initial);
    setStep('presupuestos');
  };

  const handlePresupuestosNext = async () => {
    // Validar que todos los montos sean numéricos > 0
    for (const r of BUDGET_RULES) {
      const v = parseFloat((budgets[r.cat] ?? '0').replace(',', '.'));
      if (isNaN(v) || v <= 0) { setError(`Monto inválido para ${r.cat}.`); return; }
    }
    setError('');
    if (!userId) { setStep('wow_input'); return; }
    setLoading(true);

    const now         = new Date();
    const periodoDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    // Construir template y array de upserts
    const template: Record<string, number> = {};
    const upserts = BUDGET_RULES.map(r => {
      const monto = parseFloat((budgets[r.cat] ?? '0').replace(',', '.'));
      template[r.cat] = monto;
      return { user_id: userId, categoria: r.cat, monto_limite: monto, periodo: periodoDate };
    });

    // Guardar presupuestos del mes actual
    const { error: budErr } = await supabase.from('presupuestos')
      .upsert(upserts, { onConflict: 'user_id,categoria,periodo' });
    if (budErr) { setError(budErr.message); setLoading(false); return; }

    // Guardar template + ingreso en el perfil
    const ingresoVal = parseFloat(ingreso.replace(',', '.'));
    const { error: profErr } = await supabase.from('profiles')
      .update({ ingreso_mensual: ingresoVal, presupuesto_template: template })
      .eq('id', userId);
    if (profErr) { setError(profErr.message); setLoading(false); return; }

    setLoading(false);
    setStep('wow_input');
  };

  const handleWowNext = () => {
    if (!wowItem.trim())                                    { setError('¿Qué compraste? Escribe algo.');   return; }
    const v = parseFloat(wowAmount.replace(',', '.'));
    if (isNaN(v) || v <= 0)                                { setError('Ingresa un monto válido.');         return; }
    setError('');
    setStep('wow_impact');
  };

  const handleFinish = async () => {
    if (!userId) { router.replace('/(tabs)'); return; }
    setLoading(true);
    const amount = parseFloat(wowAmount.replace(',', '.'));
    await Promise.all([
      supabase.from('transacciones').insert({
        user_id: userId, tipo: 'gasto', monto: amount,
        categoria: 'Alimentación', descripcion: wowItem.trim(),
        moneda, tipo_cambio: 1, activo: true,
      }),
      supabase.from('profiles').update({ perfil_completado: true }).eq('id', userId),
    ]);
    setLoading(false);
    router.replace('/(tabs)');
  };

  // ── Renders ────────────────────────────────────────────────────────────────

  // ── Welcome ────────────────────────────────────────────────────────────────
  if (step === 'welcome') {
    return (
      <View style={styles.center}>
        <Text style={styles.wowEmoji}>✨</Text>
        <Text style={styles.wowTitle}>¡Bienvenido/a!</Text>
        <Text style={styles.wowSub}>Hagamos tu primer registro{'\n'}para ver la magia.</Text>
        <TouchableOpacity style={styles.btn} onPress={() => setStep('profile')}>
          <Text style={styles.btnText}>Empezar →</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Profile ────────────────────────────────────────────────────────────────
  if (step === 'profile') {
    return (
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
          <StepBadge current={1} total={4} />
          <Text style={styles.title}>Cuéntanos quién eres</Text>
          <Text style={styles.sub}>Así personalizamos tu experiencia financiera.</Text>
          {!!error && <ErrorBox msg={error} />}

          <Label>Nombre</Label>
          <TextInput style={styles.input} placeholder="Tu nombre" placeholderTextColor="#9CA3AF"
            autoCapitalize="words" value={nombre} onChangeText={setNombre} editable={!loading} />

          <Label>Apellido</Label>
          <TextInput style={styles.input} placeholder="Tu apellido" placeholderTextColor="#9CA3AF"
            autoCapitalize="words" value={apellido} onChangeText={setApellido} editable={!loading} />

          <Label>Moneda base</Label>
          <TouchableOpacity style={styles.currencyBtn} onPress={() => setShowPicker(true)} disabled={loading}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={styles.currencyCode}>{selectedCurrency.code}</Text>
              <Text style={styles.currencyLbl}>{selectedCurrency.label}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.btn, styles.btnTop, loading && styles.btnDisabled]}
            onPress={handleProfileNext} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Siguiente →</Text>}
          </TouchableOpacity>
        </ScrollView>

        <Modal visible={showPicker} animationType="slide" transparent>
          <SafeAreaView style={styles.pickerBackdrop}>
            <View style={styles.pickerSheet}>
              <View style={styles.pickerHead}>
                <Text style={styles.pickerTitle}>Selecciona tu moneda</Text>
                <TouchableOpacity onPress={() => setShowPicker(false)}>
                  <Text style={styles.pickerClose}>Cerrar</Text>
                </TouchableOpacity>
              </View>
              <FlatList data={CURRENCIES} keyExtractor={i => i.code}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.pickerOpt} onPress={() => { setMoneda(item.code); setShowPicker(false); }}>
                    <View>
                      <Text style={styles.pickerCode}>{item.code}</Text>
                      <Text style={styles.pickerLbl}>{item.label}</Text>
                    </View>
                    {moneda === item.code && <Text style={styles.pickerCheck}>✓</Text>}
                  </TouchableOpacity>
                )}
                ItemSeparatorComponent={() => <View style={styles.sep} />}
              />
            </View>
          </SafeAreaView>
        </Modal>
      </KeyboardAvoidingView>
    );
  }

  // ── Ingreso ────────────────────────────────────────────────────────────────
  if (step === 'ingreso') {
    return (
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.inner}>
          <StepBadge current={2} total={4} />
          <Text style={styles.title}>Tu ingreso mensual</Text>
          <Text style={styles.sub}>
            Usaremos este dato para calcular automáticamente cuánto puedes gastar en cada categoría.
          </Text>
          {!!error && <ErrorBox msg={error} />}

          <View style={styles.ingresoRow}>
            <View style={styles.ingresoSymBox}>
              <Text style={styles.ingresoSym}>{sym}</Text>
            </View>
            <TextInput
              style={styles.ingresoInput}
              placeholder="4000"
              placeholderTextColor="#9CA3AF"
              keyboardType="decimal-pad"
              value={ingreso}
              onChangeText={setIngreso}
            />
          </View>
          <Text style={styles.hint}>Ingreso neto (después de impuestos)</Text>

          <TouchableOpacity style={[styles.btn, styles.btnTop]} onPress={handleIngresoNext}>
            <Text style={styles.btnText}>Calcular mi presupuesto →</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ── Presupuestos ───────────────────────────────────────────────────────────
  if (step === 'presupuestos') {
    const ingresoVal = parseFloat(ingreso.replace(',', '.')) || 0;
    return (
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
          <StepBadge current={3} total={4} />
          <Text style={styles.title}>Tu estrategia 50/30/20</Text>
          <Text style={styles.sub}>
            Basado en {sym} {ingresoVal.toLocaleString('es-PE')} de ingreso.
            Puedes ajustar cada límite libremente.
          </Text>

          <View style={styles.ruleCard}>
            <Text style={styles.ruleCardText}>
              <Text style={styles.bold}>50%</Text> necesidades ·{' '}
              <Text style={styles.bold}>30%</Text> deseos ·{' '}
              <Text style={styles.bold}>20%</Text> ahorro
            </Text>
          </View>

          {!!error && <ErrorBox msg={error} />}

          {BUDGET_RULES.map(r => (
            <View key={r.cat} style={styles.budRow}>
              <View style={styles.budRowLeft}>
                <Text style={styles.budIcon}>{r.icon}</Text>
                <View>
                  <Text style={styles.budCat}>{r.cat}</Text>
                  <Text style={styles.budPct}>{Math.round(r.pct * 100)}% del ingreso</Text>
                </View>
              </View>
              <View style={styles.budInputWrap}>
                <Text style={styles.budSym}>{sym}</Text>
                <TextInput
                  style={styles.budInput}
                  keyboardType="decimal-pad"
                  value={budgets[r.cat] ?? ''}
                  onChangeText={v => setBudgets(prev => ({ ...prev, [r.cat]: v }))}
                  placeholderTextColor="#9CA3AF"
                />
              </View>
            </View>
          ))}

          <Text style={styles.hint}>
            Estos límites se guardan y se replican automáticamente cada mes.
          </Text>

          <TouchableOpacity style={[styles.btn, styles.btnTop, loading && styles.btnDisabled]}
            onPress={handlePresupuestosNext} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Guardar y continuar →</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Wow Input ──────────────────────────────────────────────────────────────
  if (step === 'wow_input') {
    return (
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.inner}>
          <StepBadge current={4} total={4} />
          <Text style={styles.title}>Tu primer gasto</Text>
          <Text style={styles.sub}>
            Registra algo que hayas comprado hoy para ver el impacto real en tu presupuesto.
          </Text>
          {!!error && <ErrorBox msg={error} />}

          <Label>¿Qué compraste? (categoría: Alimentación)</Label>
          <TextInput style={styles.input} placeholder="Ej: Almuerzo, café, mercado..."
            placeholderTextColor="#9CA3AF" autoCapitalize="sentences"
            value={wowItem} onChangeText={setWowItem} />

          <Label>{`¿Cuánto costó? (${sym})`}</Label>
          <TextInput style={styles.input} placeholder="Ej: 20"
            placeholderTextColor="#9CA3AF" keyboardType="decimal-pad"
            value={wowAmount} onChangeText={setWowAmount} />

          <TouchableOpacity style={[styles.btn, styles.btnTop]} onPress={handleWowNext}>
            <Text style={styles.btnText}>Ver el impacto ✨</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ── Wow Impact ─────────────────────────────────────────────────────────────
  const wowAmt       = parseFloat(wowAmount.replace(',', '.')) || 0;
  const alimentBudget = parseFloat((budgets['Alimentación'] ?? '0').replace(',', '.'));

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.impactContainer}>
      <ImpactBanner
        item={wowItem}
        amount={wowAmt}
        budgetAmt={alimentBudget}
        currency={moneda}
      />

      <TouchableOpacity
        style={[styles.btn, styles.finishBtn, loading && styles.btnDisabled]}
        onPress={handleFinish} disabled={loading}
      >
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.btnText}>¡Empezar a usarla! 🚀</Text>
        }
      </TouchableOpacity>
      <Text style={styles.finishNote}>Tu gasto quedará guardado en el historial.</Text>
    </ScrollView>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function StepBadge({ current, total }: { current: number; total: number }) {
  return (
    <View style={styles.stepRow}>
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={[styles.stepDot, i + 1 <= current && styles.stepDotActive]} />
      ))}
      <Text style={styles.stepText}>Paso {current} de {total}</Text>
    </View>
  );
}
function Label({ children }: { children: string }) {
  return <Text style={styles.label}>{children}</Text>;
}
function ErrorBox({ msg }: { msg: string }) {
  return <View style={styles.errorBox}><Text style={styles.errorText}>{msg}</Text></View>;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex:  { flex: 1, backgroundColor: '#F9FAFB' },
  center: { flex: 1, backgroundColor: '#F9FAFB', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  inner: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40 },
  impactContainer: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 40 },

  // Welcome
  wowEmoji: { fontSize: 64, marginBottom: 20, textAlign: 'center' },
  wowTitle: { fontSize: 32, fontWeight: '800', color: '#111827', textAlign: 'center', marginBottom: 12 },
  wowSub:   { fontSize: 17, color: '#6B7280', textAlign: 'center', lineHeight: 26, marginBottom: 40 },

  // Step badge
  stepRow:       { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  stepDot:       { width: 8, height: 8, borderRadius: 4, backgroundColor: '#E5E7EB' },
  stepDotActive: { backgroundColor: '#7C3AED' },
  stepText:      { fontSize: 11, fontWeight: '600', color: '#7C3AED', textTransform: 'uppercase', letterSpacing: 0.8, marginLeft: 4 },

  // Headings
  title: { fontSize: 26, fontWeight: '700', color: '#111827', marginBottom: 6 },
  sub:   { fontSize: 14, color: '#6B7280', lineHeight: 21, marginBottom: 24 },
  hint:  { fontSize: 12, color: '#9CA3AF', marginTop: 8, marginBottom: 4 },
  bold:  { fontWeight: '700', color: '#111827' },

  // Form
  label:    { fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 },
  input:    { height: 52, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, paddingHorizontal: 16, fontSize: 16, color: '#111827', marginBottom: 16 },
  errorBox: { backgroundColor: '#FEE2E2', borderRadius: 8, padding: 12, marginBottom: 14 },
  errorText:{ color: '#DC2626', fontSize: 14 },

  // Currency picker trigger
  currencyBtn:  { height: 52, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 },
  currencyCode: { fontSize: 15, fontWeight: '700', color: '#111827' },
  currencyLbl:  { fontSize: 15, color: '#6B7280' },
  chevron:      { fontSize: 20, color: '#9CA3AF' },

  // Ingreso row
  ingresoRow:    { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, backgroundColor: '#fff', overflow: 'hidden', marginBottom: 8 },
  ingresoSymBox: { paddingHorizontal: 16, height: 56, justifyContent: 'center', borderRightWidth: 1, borderRightColor: '#E5E7EB', backgroundColor: '#F9FAFB' },
  ingresoSym:    { fontSize: 18, fontWeight: '700', color: '#374151' },
  ingresoInput:  { flex: 1, height: 56, paddingHorizontal: 16, fontSize: 24, fontWeight: '700', color: '#111827' },

  // 50/30/20 rule card
  ruleCard:     { backgroundColor: '#EDE9FE', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 20 },
  ruleCardText: { fontSize: 13, color: '#5B21B6', textAlign: 'center' },

  // Budget rows
  budRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#F3F4F6' },
  budRowLeft:  { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  budIcon:     { fontSize: 22 },
  budCat:      { fontSize: 14, fontWeight: '600', color: '#111827' },
  budPct:      { fontSize: 11, color: '#9CA3AF', marginTop: 1 },
  budInputWrap:{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, backgroundColor: '#F9FAFB', paddingHorizontal: 10, height: 44 },
  budSym:      { fontSize: 14, fontWeight: '600', color: '#6B7280', marginRight: 4 },
  budInput:    { fontSize: 16, fontWeight: '700', color: '#111827', minWidth: 70, textAlign: 'right' },

  // Buttons
  btn:        { height: 52, backgroundColor: '#3B82F6', borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  btnTop:     { marginTop: 12 },
  btnDisabled:{ opacity: 0.6 },
  btnText:    { color: '#fff', fontSize: 16, fontWeight: '600' },
  finishBtn:  { backgroundColor: '#7C3AED', marginTop: 24 },
  finishNote: { fontSize: 12, color: '#9CA3AF', textAlign: 'center', marginTop: 12 },

  // Impact banner
  bannerCard:  { backgroundColor: '#fff', borderRadius: 20, padding: 24, borderLeftWidth: 4, borderLeftColor: '#7C3AED', shadowColor: '#7C3AED', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 20, elevation: 8 },
  bannerEmoji: { fontSize: 36, textAlign: 'center', marginBottom: 10 },
  bannerTitle: { fontSize: 20, fontWeight: '800', color: '#111827', textAlign: 'center', marginBottom: 14 },
  bannerText:  { fontSize: 15, color: '#374151', lineHeight: 24, textAlign: 'center', marginBottom: 20 },
  barBg:       { height: 10, backgroundColor: '#F3F4F6', borderRadius: 5, overflow: 'hidden', marginBottom: 6 },
  barFill:     { height: '100%', borderRadius: 5 },
  barLabels:   { flexDirection: 'row', justifyContent: 'space-between' },
  barLbl:      { fontSize: 11, color: '#9CA3AF' },

  // Currency modal
  pickerBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  pickerSheet:    { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '60%', paddingBottom: 24 },
  pickerHead:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  pickerTitle:    { fontSize: 16, fontWeight: '600', color: '#111827' },
  pickerClose:    { fontSize: 15, color: '#3B82F6', fontWeight: '500' },
  pickerOpt:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 },
  pickerCode:     { fontSize: 15, fontWeight: '600', color: '#111827' },
  pickerLbl:      { fontSize: 13, color: '#6B7280', marginTop: 1 },
  pickerCheck:    { fontSize: 18, color: '#3B82F6', fontWeight: '600' },
  sep:            { height: 1, backgroundColor: '#F3F4F6', marginHorizontal: 20 },
});
