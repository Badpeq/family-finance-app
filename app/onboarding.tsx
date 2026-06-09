import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
  Animated, Modal, FlatList, SafeAreaView, ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 'welcome' | 'profile' | 'ingreso' | 'presupuestos' | 'modulos' | 'wow_input' | 'wow_impact';

interface BudgetRow {
  cat:    string;
  icon:   string;
  pct:    number;   // porcentaje sugerido del ingreso
  group:  string;
  active: boolean;
  amount: string;   // monto editable como string
}

// ─── Categorías base con mejores prácticas de gestión financiera ──────────────
// Distribución: 50% Necesidades · 27% Deseos · 3% Contingencias · 20% Ahorro (implícito)

const DEFAULT_BUDGET_ROWS: Omit<BudgetRow, 'active' | 'amount'>[] = [
  // Necesidades (50%)
  { cat: 'Vivienda',        icon: '🏠', pct: 0.25, group: 'Necesidades (50%)' },
  { cat: 'Alimentación',    icon: '🛒', pct: 0.12, group: 'Necesidades (50%)' },
  { cat: 'Transporte',      icon: '🚗', pct: 0.08, group: 'Necesidades (50%)' },
  { cat: 'Servicios',       icon: '⚡', pct: 0.03, group: 'Necesidades (50%)' },
  { cat: 'Salud',           icon: '💊', pct: 0.02, group: 'Necesidades (50%)' },
  // Deseos (27%)
  { cat: 'Entretenimiento', icon: '🎬', pct: 0.10, group: 'Deseos (27%)' },
  { cat: 'Ropa',            icon: '👕', pct: 0.05, group: 'Deseos (27%)' },
  { cat: 'Educación',       icon: '📚', pct: 0.07, group: 'Deseos (27%)' },
  { cat: 'Restaurantes',    icon: '🍽️', pct: 0.05, group: 'Deseos (27%)' },
  // Contingencias (3%)
  { cat: 'Otros',           icon: '📦', pct: 0.03, group: 'Contingencias (3%)' },
];

const CUSTOM_ICONS = ['🎯','🛍️','🐾','✈️','🎮','💄','🔧','🎵','📱','🏋️','🌿','💡'];

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

function buildRows(ingreso: number): BudgetRow[] {
  return DEFAULT_BUDGET_ROWS.map(r => ({
    ...r,
    active: true,
    amount: (Math.round(ingreso * r.pct * 100) / 100).toFixed(2),
  }));
}

// ─── Animated Impact Banner ───────────────────────────────────────────────────

function ImpactBanner({
  item, category, amount, budgetAmt, currency,
}: {
  item: string; category: string; amount: number; budgetAmt: number; currency: string;
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
    <Animated.View style={[s.bannerCard, { opacity, transform: [{ translateY: slideY }] }]}>
      <Text style={s.bannerEmoji}>🎯</Text>
      <Text style={s.bannerTitle}>¡Impacto calculado!</Text>
      <Text style={s.bannerText}>
        Al registrar <Text style={s.bold}>{item}</Text> de{' '}
        <Text style={s.bold}>{sym} {amount.toFixed(2)}</Text>, te queda el{' '}
        <Text style={[s.bold, { color: barColor }]}>{100 - pct}%</Text> de tu
        presupuesto de <Text style={s.bold}>{category}</Text>.{'\n\n'}
        <Text style={[s.bold, { color: '#22C55E' }]}>{sym} {remaining.toFixed(2)} restantes</Text>
        {' '}de los <Text style={s.bold}>{sym} {budgetAmt.toFixed(2)}</Text> que definiste.
        {'\n'}¡Dale seguimiento real desde tu Dashboard!
      </Text>
      <View style={s.barBg}>
        <Animated.View style={[s.barFill, {
          backgroundColor: barColor,
          width: barW.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
        }]} />
      </View>
      <View style={s.barLabels}>
        <Text style={s.barLbl}>{sym} 0</Text>
        <Text style={[s.barLbl, { color: barColor, fontWeight: '700' }]}>{pct}% usado</Text>
        <Text style={s.barLbl}>{sym} {budgetAmt.toFixed(0)}</Text>
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
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);

  // Ingreso
  const [ingreso, setIngreso] = useState('');

  // Presupuestos
  const [budgetRows,    setBudgetRows]    = useState<BudgetRow[]>([]);
  const [showAddCat,    setShowAddCat]    = useState(false);
  const [newCatName,    setNewCatName]    = useState('');
  const [newCatAmount,  setNewCatAmount]  = useState('');
  const [newCatIcon,    setNewCatIcon]    = useState('🎯');
  const [showIconPicker, setShowIconPicker] = useState(false);

  // Módulos
  const [wantsAhorros,   setWantsAhorros]   = useState<boolean | null>(null);
  const [wantsPrestamos, setWantsPrestamos] = useState<boolean | null>(null);

  // Wow
  const [wowItem,   setWowItem]   = useState('');
  const [wowAmount, setWowAmount] = useState('');

  // UI state
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [userId,  setUserId]  = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id ?? null));
  }, []);

  const sym              = SYM[moneda] ?? moneda;
  const selectedCurrency = CURRENCIES.find(c => c.code === moneda)!;

  // Categoría para el WOW: primera activa (preferimos Alimentación)
  const wowRow = budgetRows.find(r => r.cat === 'Alimentación' && r.active)
              ?? budgetRows.find(r => r.active);

  // Total asignado (solo activos)
  const totalAssigned = budgetRows
    .filter(r => r.active)
    .reduce((sum, r) => sum + (parseFloat(r.amount.replace(',', '.')) || 0), 0);
  const ingresoVal = parseFloat(ingreso.replace(',', '.')) || 0;
  const pctAssigned = ingresoVal > 0 ? Math.round((totalAssigned / ingresoVal) * 100) : 0;

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
    setBudgetRows(buildRows(val));
    setStep('presupuestos');
  };

  const handleSkipIngreso = async () => {
    // Presupuestos base estandarizados (sin ingreso real)
    const BASE_AMOUNTS: Record<string, number> = {
      Vivienda: 500, Alimentación: 300, Transporte: 150, Servicios: 80,
      Salud: 50, Entretenimiento: 100, Ropa: 80, Educación: 100,
      Restaurantes: 80, Otros: 60,
    };
    const rows = DEFAULT_BUDGET_ROWS.map(r => ({
      ...r, active: true, amount: String(BASE_AMOUNTS[r.cat] ?? 50),
    }));
    setBudgetRows(rows);
    if (userId) {
      setLoading(true);
      const now = new Date();
      const periodoDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const template: Record<string, number> = {};
      const upserts = rows.map(r => {
        template[r.cat] = Number(r.amount);
        return { user_id: userId, categoria: r.cat, monto_limite: Number(r.amount), periodo: periodoDate };
      });
      await supabase.from('presupuestos').upsert(upserts, { onConflict: 'user_id,categoria,periodo' });
      await supabase.from('profiles').update({ ingreso_mensual: 0, presupuesto_template: template }).eq('id', userId);
      setLoading(false);
    }
    setStep('modulos');
  };

  const handleToggleRow = (cat: string) => {
    setBudgetRows(prev => prev.map(r => r.cat === cat ? { ...r, active: !r.active } : r));
  };

  const handleAmountChange = (cat: string, val: string) => {
    setBudgetRows(prev => prev.map(r => r.cat === cat ? { ...r, amount: val } : r));
  };

  const handleAddCustomCat = () => {
    if (!newCatName.trim()) { setError('Escribe un nombre para la categoría.'); return; }
    const amt = parseFloat(newCatAmount.replace(',', '.'));
    if (isNaN(amt) || amt <= 0) { setError('Ingresa un monto válido.'); return; }
    if (budgetRows.some(r => r.cat.toLowerCase() === newCatName.trim().toLowerCase())) {
      setError('Ya existe una categoría con ese nombre.'); return;
    }
    setError('');
    setBudgetRows(prev => [...prev, {
      cat: newCatName.trim(), icon: newCatIcon, pct: 0,
      group: 'Personalizado', active: true, amount: amt.toFixed(2),
    }]);
    setNewCatName(''); setNewCatAmount(''); setNewCatIcon('🎯');
    setShowAddCat(false);
  };

  const handlePresupuestosNext = async () => {
    const active = budgetRows.filter(r => r.active);
    if (active.length === 0) { setError('Activa al menos una categoría.'); return; }
    for (const r of active) {
      const v = parseFloat(r.amount.replace(',', '.'));
      if (isNaN(v) || v <= 0) { setError(`Monto inválido en ${r.cat}.`); return; }
    }
    setError('');
    if (!userId) { setStep('modulos'); return; }
    setLoading(true);

    const now         = new Date();
    const periodoDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const template: Record<string, number> = {};
    const upserts = active.map(r => {
      const monto = parseFloat(r.amount.replace(',', '.'));
      template[r.cat] = monto;
      return { user_id: userId, categoria: r.cat, monto_limite: monto, periodo: periodoDate };
    });

    const { error: budErr } = await supabase.from('presupuestos')
      .upsert(upserts, { onConflict: 'user_id,categoria,periodo' });
    if (budErr) { setError(budErr.message); setLoading(false); return; }

    const { error: profErr } = await supabase.from('profiles')
      .update({ ingreso_mensual: ingresoVal, presupuesto_template: template })
      .eq('id', userId);
    if (profErr) { setError(profErr.message); setLoading(false); return; }

    setLoading(false);
    setStep('modulos');
  };

  const handleModulosNext = () => {
    if (wantsAhorros === null || wantsPrestamos === null) {
      setError('Responde las dos preguntas para continuar.');
      return;
    }
    setError('');
    setStep('wow_input');
  };

  const handleWowNext = () => {
    if (!wowItem.trim())                                  { setError('¿Qué compraste? Escribe algo.'); return; }
    const v = parseFloat(wowAmount.replace(',', '.'));
    if (isNaN(v) || v <= 0)                              { setError('Ingresa un monto válido.'); return; }
    setError('');
    setStep('wow_impact');
  };

  const handleFinish = async () => {
    if (!userId) { router.replace('/(tabs)'); return; }
    setLoading(true);
    const amount = parseFloat(wowAmount.replace(',', '.'));
    await Promise.all([
      supabase.from('transacciones').insert({
        user_id:     userId,
        tipo:        'gasto',
        monto:       amount,
        categoria:   wowRow?.cat ?? 'Alimentación',
        descripcion: wowItem.trim(),
        moneda,
        tipo_cambio: 1,
        activo:      true,
      }),
      supabase.from('profiles').update({
        perfil_completado:  true,
        modulo_ahorros:     wantsAhorros   ?? false,
        modulo_prestamos:   wantsPrestamos ?? false,
      }).eq('id', userId),
    ]);
    setLoading(false);
    router.replace('/(tabs)');
  };

  // ── Renders ────────────────────────────────────────────────────────────────

  // ── Welcome ────────────────────────────────────────────────────────────────
  if (step === 'welcome') {
    return (
      <View style={s.center}>
        <Text style={{ fontSize: 64, marginBottom: 20 }}>✨</Text>
        <Text style={s.wowTitle}>¡Bienvenido/a!</Text>
        <Text style={s.wowSub}>Hagamos tu primer registro{'\n'}para ver la magia.</Text>
        <TouchableOpacity style={s.btn} onPress={() => setStep('profile')}>
          <Text style={s.btnText}>Empezar →</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Profile ────────────────────────────────────────────────────────────────
  if (step === 'profile') {
    return (
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.inner} keyboardShouldPersistTaps="handled">
          <StepBadge current={1} total={5} />
          <Text style={s.title}>Cuéntanos quién eres</Text>
          <Text style={s.sub}>Así personalizamos tu experiencia financiera.</Text>
          {!!error && <ErrBox msg={error} />}

          <Lbl>Nombre</Lbl>
          <TextInput style={s.input} placeholder="Tu nombre" placeholderTextColor="#9CA3AF"
            autoCapitalize="words" value={nombre} onChangeText={setNombre} editable={!loading} />
          <Lbl>Apellido</Lbl>
          <TextInput style={s.input} placeholder="Tu apellido" placeholderTextColor="#9CA3AF"
            autoCapitalize="words" value={apellido} onChangeText={setApellido} editable={!loading} />
          <Lbl>Moneda base</Lbl>
          <TouchableOpacity style={s.currencyBtn} onPress={() => setShowCurrencyPicker(true)} disabled={loading}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={s.currencyCode}>{selectedCurrency.code}</Text>
              <Text style={s.currencyLbl}>{selectedCurrency.label}</Text>
            </View>
            <Text style={s.chevron}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.btn, { marginTop: 12 }, loading && s.btnOff]}
            onPress={handleProfileNext} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Siguiente →</Text>}
          </TouchableOpacity>
        </ScrollView>

        <Modal visible={showCurrencyPicker} animationType="slide" transparent>
          <SafeAreaView style={s.pickerBg}>
            <View style={s.pickerSheet}>
              <View style={s.pickerHead}>
                <Text style={s.pickerTitle}>Selecciona tu moneda</Text>
                <TouchableOpacity onPress={() => setShowCurrencyPicker(false)}>
                  <Text style={s.pickerClose}>Cerrar</Text>
                </TouchableOpacity>
              </View>
              <FlatList data={CURRENCIES} keyExtractor={i => i.code}
                renderItem={({ item }) => (
                  <TouchableOpacity style={s.pickerOpt}
                    onPress={() => { setMoneda(item.code); setShowCurrencyPicker(false); }}>
                    <View>
                      <Text style={s.pickerCode}>{item.code}</Text>
                      <Text style={s.pickerLbl}>{item.label}</Text>
                    </View>
                    {moneda === item.code && <Text style={{ color: '#3B82F6', fontSize: 18 }}>✓</Text>}
                  </TouchableOpacity>
                )}
                ItemSeparatorComponent={() => <View style={s.sep} />}
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
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.inner}>
          <StepBadge current={2} total={5} />
          <Text style={s.title}>Tu ingreso mensual</Text>
          <Text style={s.sub}>
            Usaremos este dato para calcular automáticamente cuánto puedes gastar en cada categoría.
          </Text>
          {!!error && <ErrBox msg={error} />}

          <View style={s.ingresoRow}>
            <View style={s.ingresoSymBox}>
              <Text style={s.ingresoSym}>{sym}</Text>
            </View>
            <TextInput style={s.ingresoInput} placeholder="4000" placeholderTextColor="#9CA3AF"
              keyboardType="decimal-pad" value={ingreso} onChangeText={setIngreso} />
          </View>
          <Text style={s.hint}>Ingreso neto (después de impuestos)</Text>

          <TouchableOpacity style={[s.btn, { marginTop: 20 }]} onPress={handleIngresoNext}>
            <Text style={s.btnText}>Calcular mi presupuesto →</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.skipBtn} onPress={handleSkipIngreso} disabled={loading}>
            {loading
              ? <ActivityIndicator color="#9CA3AF" size="small" />
              : <Text style={s.skipBtnText}>Configurar ingresos más tarde</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ── Presupuestos ───────────────────────────────────────────────────────────
  if (step === 'presupuestos') {
    // Agrupar filas por grupo
    const groups = Array.from(new Set(budgetRows.map(r => r.group)));

    return (
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 40, paddingBottom: 60 }}
          keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          <StepBadge current={3} total={5} />
          <Text style={s.title}>Tu plan de presupuestos</Text>
          <Text style={s.sub}>
            Basado en {sym} {ingresoVal.toLocaleString('es-PE')} de ingreso.
            Activa, desactiva o ajusta cada categoría.
          </Text>

          {/* Indicador de % asignado */}
          <View style={[s.totalBar, { borderColor: pctAssigned > 95 ? '#DC2626' : '#E5E7EB' }]}>
            <View style={{ flex: 1 }}>
              <Text style={s.totalBarLabel}>Total asignado</Text>
              <Text style={[s.totalBarPct, { color: pctAssigned > 95 ? '#DC2626' : pctAssigned > 80 ? '#F59E0B' : '#22C55E' }]}>
                {pctAssigned}% del ingreso
              </Text>
            </View>
            <Text style={s.totalBarAmt}>{sym} {totalAssigned.toFixed(0)}</Text>
          </View>

          <View style={s.ruleChip}>
            <Text style={s.ruleChipText}>
              💡 Mejor práctica: <Text style={{ fontWeight: '700' }}>50%</Text> necesidades ·{' '}
              <Text style={{ fontWeight: '700' }}>30%</Text> deseos ·{' '}
              <Text style={{ fontWeight: '700' }}>20%</Text> ahorro/inversión
            </Text>
          </View>

          {!!error && <ErrBox msg={error} />}

          {groups.map(group => (
            <View key={group}>
              <Text style={s.groupLabel}>{group}</Text>
              {budgetRows.filter(r => r.group === group).map(row => (
                <View key={row.cat} style={[s.budRow, !row.active && s.budRowOff]}>
                  <TouchableOpacity style={s.budToggle} onPress={() => handleToggleRow(row.cat)}>
                    <View style={[s.checkBox, row.active && s.checkBoxOn]}>
                      {row.active && <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>✓</Text>}
                    </View>
                  </TouchableOpacity>
                  <Text style={[s.budIcon, !row.active && { opacity: 0.35 }]}>{row.icon}</Text>
                  <View style={s.budCatWrap}>
                    <Text style={[s.budCat, !row.active && { color: '#9CA3AF' }]}>{row.cat}</Text>
                    {row.pct > 0 && (
                      <Text style={s.budPctLabel}>{Math.round(row.pct * 100)}%</Text>
                    )}
                  </View>
                  <View style={[s.budAmtWrap, !row.active && { opacity: 0.4 }]}>
                    <Text style={s.budAmtSym}>{sym}</Text>
                    <TextInput
                      style={s.budAmtInput}
                      keyboardType="decimal-pad"
                      value={row.amount}
                      onChangeText={v => handleAmountChange(row.cat, v)}
                      editable={row.active}
                      selectTextOnFocus
                    />
                  </View>
                </View>
              ))}
            </View>
          ))}

          {/* Agregar categoría personalizada */}
          {!showAddCat ? (
            <TouchableOpacity style={s.addCatBtn} onPress={() => setShowAddCat(true)}>
              <Text style={s.addCatBtnText}>＋ Agregar categoría personalizada</Text>
            </TouchableOpacity>
          ) : (
            <View style={s.addCatForm}>
              <Text style={s.groupLabel}>Nueva categoría</Text>

              {/* Selector de ícono */}
              <TouchableOpacity style={s.iconPickerBtn} onPress={() => setShowIconPicker(true)}>
                <Text style={{ fontSize: 28 }}>{newCatIcon}</Text>
                <Text style={s.iconPickerLabel}>Cambiar ícono</Text>
              </TouchableOpacity>

              <Lbl>Nombre</Lbl>
              <TextInput style={s.input} placeholder="Ej: Mascotas, Viajes..." placeholderTextColor="#9CA3AF"
                autoCapitalize="sentences" value={newCatName} onChangeText={setNewCatName} />
              <Lbl>{`Monto mensual (${sym})`}</Lbl>
              <TextInput style={s.input} placeholder="0.00" placeholderTextColor="#9CA3AF"
                keyboardType="decimal-pad" value={newCatAmount} onChangeText={setNewCatAmount} />

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                <TouchableOpacity style={[s.btn, { flex: 1, backgroundColor: '#22C55E' }]} onPress={handleAddCustomCat}>
                  <Text style={s.btnText}>Agregar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.btn, { flex: 1, backgroundColor: '#F3F4F6' }]}
                  onPress={() => { setShowAddCat(false); setNewCatName(''); setNewCatAmount(''); setError(''); }}>
                  <Text style={[s.btnText, { color: '#374151' }]}>Cancelar</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <TouchableOpacity style={[s.btn, { marginTop: 24 }, loading && s.btnOff]}
            onPress={handlePresupuestosNext} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Guardar y continuar →</Text>}
          </TouchableOpacity>
        </ScrollView>

        {/* Icon Picker Modal */}
        <Modal visible={showIconPicker} animationType="fade" transparent>
          <TouchableOpacity style={s.iconModalBg} activeOpacity={1} onPress={() => setShowIconPicker(false)}>
            <View style={s.iconModalBox}>
              <Text style={[s.groupLabel, { marginBottom: 12 }]}>Elige un ícono</Text>
              <View style={s.iconGrid}>
                {CUSTOM_ICONS.map(icon => (
                  <TouchableOpacity key={icon} style={[s.iconOpt, newCatIcon === icon && s.iconOptOn]}
                    onPress={() => { setNewCatIcon(icon); setShowIconPicker(false); }}>
                    <Text style={{ fontSize: 28 }}>{icon}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </TouchableOpacity>
        </Modal>
      </KeyboardAvoidingView>
    );
  }

  // ── Módulos ────────────────────────────────────────────────────────────────
  if (step === 'modulos') {
    return (
      <ScrollView style={s.flex} contentContainerStyle={s.inner} keyboardShouldPersistTaps="handled">
        <StepBadge current={4} total={5} />
        <Text style={s.title}>Personaliza tu app</Text>
        <Text style={s.sub}>
          Activa solo los módulos que necesitas. Podrás cambiarlos después en Configuración.
        </Text>
        {!!error && <ErrBox msg={error} />}

        {/* Ahorros */}
        <View style={s.moduloCard}>
          <Text style={s.moduloIcon}>🏦</Text>
          <Text style={s.moduloTitle}>Ahorros & Inversiones</Text>
          <Text style={s.moduloSub}>
            Registra movimientos en cuentas de ahorro, fondos mutuos o inversiones.
          </Text>
          <View style={s.yesNoRow}>
            <TouchableOpacity
              style={[s.yesNoBtn, wantsAhorros === true && s.yesNoBtnOn]}
              onPress={() => setWantsAhorros(true)}>
              <Text style={[s.yesNoText, wantsAhorros === true && s.yesNoTextOn]}>Sí, lo quiero</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.yesNoBtn, wantsAhorros === false && s.yesNoBtnOff]}
              onPress={() => setWantsAhorros(false)}>
              <Text style={[s.yesNoText, wantsAhorros === false && s.yesNoTextOff]}>No por ahora</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Préstamos */}
        <View style={s.moduloCard}>
          <Text style={s.moduloIcon}>📋</Text>
          <Text style={s.moduloTitle}>Préstamos y Créditos</Text>
          <Text style={s.moduloSub}>
            Gestiona tarjetas de crédito, préstamos bancarios o deudas personales.
          </Text>
          <View style={s.yesNoRow}>
            <TouchableOpacity
              style={[s.yesNoBtn, wantsPrestamos === true && s.yesNoBtnOn]}
              onPress={() => setWantsPrestamos(true)}>
              <Text style={[s.yesNoText, wantsPrestamos === true && s.yesNoTextOn]}>Sí, lo quiero</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.yesNoBtn, wantsPrestamos === false && s.yesNoBtnOff]}
              onPress={() => setWantsPrestamos(false)}>
              <Text style={[s.yesNoText, wantsPrestamos === false && s.yesNoTextOff]}>No por ahora</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity style={[s.btn, { marginTop: 8 }]} onPress={handleModulosNext}>
          <Text style={s.btnText}>Siguiente →</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ── Wow Input ──────────────────────────────────────────────────────────────
  if (step === 'wow_input') {
    const catLabel = wowRow ? `${wowRow.icon} ${wowRow.cat}` : 'Alimentación';
    return (
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.inner}>
          <StepBadge current={5} total={5} />
          <Text style={s.title}>Tu primer gasto</Text>
          <Text style={s.sub}>
            Registra algo que hayas comprado hoy para ver el impacto real en tu presupuesto.
          </Text>
          {!!error && <ErrBox msg={error} />}

          <Lbl>{`¿Qué compraste? (categoría: ${catLabel})`}</Lbl>
          <TextInput style={s.input} placeholder="Ej: Almuerzo, café, mercado..."
            placeholderTextColor="#9CA3AF" autoCapitalize="sentences"
            value={wowItem} onChangeText={setWowItem} />

          <Lbl>{`¿Cuánto costó? (${sym})`}</Lbl>
          <TextInput style={s.input} placeholder="Ej: 20"
            placeholderTextColor="#9CA3AF" keyboardType="decimal-pad"
            value={wowAmount} onChangeText={setWowAmount} />

          <TouchableOpacity style={[s.btn, { marginTop: 12 }]} onPress={handleWowNext}>
            <Text style={s.btnText}>Ver el impacto ✨</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ── Wow Impact ─────────────────────────────────────────────────────────────
  const wowAmt       = parseFloat(wowAmount.replace(',', '.')) || 0;
  const wowBudgetAmt = parseFloat((wowRow?.amount ?? '0').replace(',', '.'));

  return (
    <ScrollView style={s.flex} contentContainerStyle={s.impactWrap}>
      <ImpactBanner
        item={wowItem}
        category={wowRow?.cat ?? 'Alimentación'}
        amount={wowAmt}
        budgetAmt={wowBudgetAmt}
        currency={moneda}
      />
      <TouchableOpacity style={[s.btn, s.finishBtn, loading && s.btnOff]}
        onPress={handleFinish} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>¡Empezar a usarla! 🚀</Text>}
      </TouchableOpacity>
      <Text style={s.finishNote}>Tu gasto quedará guardado en el historial.</Text>
    </ScrollView>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function StepBadge({ current, total }: { current: number; total: number }) {
  return (
    <View style={s.stepRow}>
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={[s.stepDot, i + 1 <= current && s.stepDotOn]} />
      ))}
      <Text style={s.stepText}>Paso {current} de {total}</Text>
    </View>
  );
}
function Lbl({ children }: { children: string }) {
  return <Text style={s.label}>{children}</Text>;
}
function ErrBox({ msg }: { msg: string }) {
  return <View style={s.errBox}><Text style={s.errText}>{msg}</Text></View>;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  flex:    { flex: 1, backgroundColor: '#F9FAFB' },
  center:  { flex: 1, backgroundColor: '#F9FAFB', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  inner:   { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40 },
  impactWrap: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 40 },

  wowTitle: { fontSize: 32, fontWeight: '800', color: '#111827', textAlign: 'center', marginBottom: 12 },
  wowSub:   { fontSize: 17, color: '#6B7280', textAlign: 'center', lineHeight: 26, marginBottom: 40 },

  stepRow:    { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  stepDot:    { width: 8, height: 8, borderRadius: 4, backgroundColor: '#E5E7EB' },
  stepDotOn:  { backgroundColor: '#7C3AED' },
  stepText:   { fontSize: 11, fontWeight: '600', color: '#7C3AED', textTransform: 'uppercase', letterSpacing: 0.8, marginLeft: 4 },

  title:  { fontSize: 26, fontWeight: '700', color: '#111827', marginBottom: 6 },
  sub:    { fontSize: 14, color: '#6B7280', lineHeight: 21, marginBottom: 20 },
  hint:   { fontSize: 12, color: '#9CA3AF', marginTop: 6 },
  bold:   { fontWeight: '700', color: '#111827' },
  label:  { fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 },
  input:  { height: 52, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, paddingHorizontal: 16, fontSize: 16, color: '#111827', marginBottom: 14 },
  errBox: { backgroundColor: '#FEE2E2', borderRadius: 8, padding: 12, marginBottom: 12 },
  errText:{ color: '#DC2626', fontSize: 14 },
  sep:    { height: 1, backgroundColor: '#F3F4F6', marginHorizontal: 20 },

  btn:       { height: 52, backgroundColor: '#3B82F6', borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  btnOff:    { opacity: 0.6 },
  btnText:   { color: '#fff', fontSize: 16, fontWeight: '600' },
  finishBtn: { backgroundColor: '#7C3AED', marginTop: 24 },
  skipBtn:   { marginTop: 14, alignItems: 'center', paddingVertical: 10 },
  skipBtnText:{ fontSize: 14, color: '#9CA3AF', textDecorationLine: 'underline' },
  finishNote:{ fontSize: 12, color: '#9CA3AF', textAlign: 'center', marginTop: 12 },

  currencyBtn:  { height: 52, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 },
  currencyCode: { fontSize: 15, fontWeight: '700', color: '#111827' },
  currencyLbl:  { fontSize: 15, color: '#6B7280' },
  chevron:      { fontSize: 20, color: '#9CA3AF' },

  ingresoRow:    { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, backgroundColor: '#fff', overflow: 'hidden', marginBottom: 8 },
  ingresoSymBox: { paddingHorizontal: 16, height: 56, justifyContent: 'center', borderRightWidth: 1, borderRightColor: '#E5E7EB', backgroundColor: '#F9FAFB' },
  ingresoSym:    { fontSize: 18, fontWeight: '700', color: '#374151' },
  ingresoInput:  { flex: 1, height: 56, paddingHorizontal: 16, fontSize: 24, fontWeight: '700', color: '#111827' },

  // Total bar
  totalBar:      { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1.5, marginBottom: 12 },
  totalBarLabel: { fontSize: 12, color: '#6B7280', marginBottom: 2 },
  totalBarPct:   { fontSize: 16, fontWeight: '800' },
  totalBarAmt:   { fontSize: 18, fontWeight: '700', color: '#111827' },

  ruleChip:     { backgroundColor: '#EDE9FE', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 20 },
  ruleChipText: { fontSize: 12, color: '#5B21B6', lineHeight: 18 },

  groupLabel: { fontSize: 11, fontWeight: '700', color: '#9CA3AF', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8, marginTop: 4 },

  // Budget rows
  budRow:      { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#F3F4F6', gap: 8 },
  budRowOff:   { backgroundColor: '#F9FAFB', borderColor: '#F3F4F6' },
  budToggle:   { padding: 2 },
  checkBox:    { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#D1D5DB', justifyContent: 'center', alignItems: 'center' },
  checkBoxOn:  { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  budIcon:     { fontSize: 20 },
  budCatWrap:  { flex: 1, minWidth: 0 },
  budCat:      { fontSize: 13, fontWeight: '600', color: '#111827' },
  budPctLabel: { fontSize: 10, color: '#9CA3AF', marginTop: 1 },
  budAmtWrap:  { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8, backgroundColor: '#F9FAFB', paddingHorizontal: 8, height: 38 },
  budAmtSym:   { fontSize: 12, fontWeight: '600', color: '#6B7280', marginRight: 2 },
  budAmtInput: { fontSize: 14, fontWeight: '700', color: '#111827', minWidth: 64, textAlign: 'right' },

  // Add category
  addCatBtn:     { borderWidth: 1.5, borderColor: '#7C3AED', borderStyle: 'dashed', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  addCatBtnText: { fontSize: 14, color: '#7C3AED', fontWeight: '600' },
  addCatForm:    { backgroundColor: '#F5F3FF', borderRadius: 14, padding: 16, marginTop: 8, borderWidth: 1, borderColor: '#DDD6FE' },
  iconPickerBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14, backgroundColor: '#fff', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  iconPickerLabel:{ fontSize: 14, color: '#7C3AED', fontWeight: '500' },
  iconModalBg:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  iconModalBox:  { backgroundColor: '#fff', borderRadius: 20, padding: 20, width: '100%', maxWidth: 320 },
  iconGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  iconOpt:       { width: 52, height: 52, borderRadius: 12, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center' },
  iconOptOn:     { backgroundColor: '#EDE9FE', borderWidth: 2, borderColor: '#7C3AED' },

  // Módulos yes/no cards
  moduloCard:  { backgroundColor: '#fff', borderRadius: 16, padding: 20, marginBottom: 14, borderWidth: 1, borderColor: '#F3F4F6', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  moduloIcon:  { fontSize: 32, marginBottom: 8 },
  moduloTitle: { fontSize: 17, fontWeight: '700', color: '#111827', marginBottom: 4 },
  moduloSub:   { fontSize: 13, color: '#6B7280', lineHeight: 19, marginBottom: 16 },
  yesNoRow:    { flexDirection: 'row', gap: 10 },
  yesNoBtn:    { flex: 1, height: 42, borderRadius: 10, borderWidth: 1.5, borderColor: '#E5E7EB', justifyContent: 'center', alignItems: 'center', backgroundColor: '#F9FAFB' },
  yesNoBtnOn:  { backgroundColor: '#EDE9FE', borderColor: '#7C3AED' },
  yesNoBtnOff: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  yesNoText:   { fontSize: 14, fontWeight: '600', color: '#6B7280' },
  yesNoTextOn: { color: '#7C3AED' },
  yesNoTextOff:{ color: '#DC2626' },

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
  pickerBg:    { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  pickerSheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '60%', paddingBottom: 24 },
  pickerHead:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  pickerTitle: { fontSize: 16, fontWeight: '600', color: '#111827' },
  pickerClose: { fontSize: 15, color: '#3B82F6', fontWeight: '500' },
  pickerOpt:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 },
  pickerCode:  { fontSize: 15, fontWeight: '600', color: '#111827' },
  pickerLbl:   { fontSize: 13, color: '#6B7280', marginTop: 1 },
});
