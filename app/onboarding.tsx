import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
  Modal,
  FlatList,
  SafeAreaView,
  ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 'welcome' | 'profile' | 'wow_input' | 'wow_impact';

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

const FICTION_BUDGET = 100; // presupuesto ficticio en PEN para el wow moment

// ─── Animated Banner ──────────────────────────────────────────────────────────

function ImpactBanner({
  item,
  amount,
  currency,
}: {
  item: string;
  amount: number;
  currency: string;
}) {
  const slideY  = useRef(new Animated.Value(40)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const scaleY  = useRef(new Animated.Value(0)).current;

  const pct        = Math.min(Math.round((amount / FICTION_BUDGET) * 100), 100);
  const remaining  = Math.max(FICTION_BUDGET - amount, 0);
  const sym        = SYM[currency] ?? currency;
  const color      = pct >= 90 ? '#DC2626' : pct >= 70 ? '#F59E0B' : '#22C55E';

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(slideY,  { toValue: 0, duration: 450, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 450, useNativeDriver: true }),
      ]),
      Animated.delay(200),
      Animated.timing(scaleY, { toValue: pct / 100, duration: 600, useNativeDriver: false }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[styles.bannerCard, { opacity, transform: [{ translateY: slideY }] }]}>
      <Text style={styles.bannerEmoji}>🎯</Text>
      <Text style={styles.bannerTitle}>¡Impacto calculado!</Text>
      <Text style={styles.bannerText}>
        Con <Text style={styles.bannerBold}>{item}</Text> de{' '}
        <Text style={styles.bannerBold}>{sym} {amount.toFixed(2)}</Text>, tu presupuesto
        de Alimentación está al{' '}
        <Text style={[styles.bannerBold, { color }]}>{pct}%</Text>.
        {'\n\n'}
        Te quedan{' '}
        <Text style={[styles.bannerBold, { color: '#22C55E' }]}>
          {sym} {remaining.toFixed(2)}
        </Text>{' '}
        para la semana si quieres cumplir tu meta de ahorro.
      </Text>

      {/* progress bar */}
      <View style={styles.barBg}>
        <Animated.View
          style={[
            styles.barFill,
            {
              backgroundColor: color,
              width: scaleY.interpolate({
                inputRange: [0, 1],
                outputRange: ['0%', '100%'],
              }),
            },
          ]}
        />
      </View>
      <View style={styles.barLabels}>
        <Text style={styles.barLabel}>{sym} 0</Text>
        <Text style={[styles.barLabel, { color }]}>{pct}% usado</Text>
        <Text style={styles.barLabel}>{sym} {FICTION_BUDGET}</Text>
      </View>
    </Animated.View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Onboarding() {
  const [step, setStep] = useState<Step>('welcome');

  // Profile fields
  const [nombre,     setNombre]     = useState('');
  const [apellido,   setApellido]   = useState('');
  const [moneda,     setMoneda]     = useState('PEN');
  const [showPicker, setShowPicker] = useState(false);

  // Wow fields
  const [wowItem,   setWowItem]   = useState('');
  const [wowAmount, setWowAmount] = useState('');

  // Loading / error
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [userId,  setUserId]  = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id ?? null);
    });
  }, []);

  const selectedCurrency = CURRENCIES.find(c => c.code === moneda)!;

  // ── Step handlers ──────────────────────────────────────────────────────────

  const handleProfileSave = async () => {
    if (!nombre.trim() || !apellido.trim()) {
      setError('Ingresa tu nombre y apellido.');
      return;
    }
    if (!userId) {
      setError('Sesión no encontrada. Vuelve a iniciar sesión.');
      return;
    }
    setError('');
    setLoading(true);

    const { error } = await supabase
      .from('profiles')
      .update({
        nombre:   nombre.trim(),
        apellido: apellido.trim(),
        moneda_base: moneda,
      })
      .eq('id', userId);

    setLoading(false);
    if (error) { setError(error.message); return; }
    setStep('wow_input');
  };

  const handleWowSubmit = () => {
    const item   = wowItem.trim();
    const amount = parseFloat(wowAmount.replace(',', '.'));

    if (!item) {
      setError('¿Qué compraste? Escribe algo.');
      return;
    }
    if (isNaN(amount) || amount <= 0) {
      setError('Ingresa un monto válido.');
      return;
    }
    setError('');
    setStep('wow_impact');
  };

  const handleFinish = async () => {
    if (!userId) { router.replace('/(tabs)'); return; }
    setLoading(true);

    const amount = parseFloat(wowAmount.replace(',', '.'));
    const item   = wowItem.trim();

    // Save the real first transaction
    await supabase.from('transacciones').insert({
      user_id:     userId,
      tipo:        'gasto',
      monto:       amount,
      categoria:   'Alimentación',
      descripcion: item,
      moneda,
      tipo_cambio: 1,
      activo:      true,
    });

    // Mark profile as completed
    await supabase
      .from('profiles')
      .update({ perfil_completado: true })
      .eq('id', userId);

    setLoading(false);
    router.replace('/(tabs)');
  };

  // ── Renders ────────────────────────────────────────────────────────────────

  if (step === 'welcome') {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.wowEmoji}>✨</Text>
        <Text style={styles.wowTitle}>¡Bienvenido/a!</Text>
        <Text style={styles.wowSubtitle}>
          Hagamos tu primer registro{'\n'}para ver la magia.
        </Text>
        <TouchableOpacity style={styles.button} onPress={() => setStep('profile')}>
          <Text style={styles.buttonText}>Empezar →</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (step === 'profile') {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.inner}>
          <Text style={styles.stepBadge}>Paso 1 de 2</Text>
          <Text style={styles.title}>Cuéntanos quién eres</Text>
          <Text style={styles.subtitle}>Así personalizamos tu experiencia.</Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Text style={styles.label}>Nombre</Text>
          <TextInput
            style={styles.input}
            placeholder="Tu nombre"
            placeholderTextColor="#9CA3AF"
            autoCapitalize="words"
            value={nombre}
            onChangeText={setNombre}
            editable={!loading}
          />

          <Text style={styles.label}>Apellido</Text>
          <TextInput
            style={styles.input}
            placeholder="Tu apellido"
            placeholderTextColor="#9CA3AF"
            autoCapitalize="words"
            value={apellido}
            onChangeText={setApellido}
            editable={!loading}
          />

          <Text style={styles.label}>Moneda base</Text>
          <TouchableOpacity
            style={styles.currencyButton}
            onPress={() => setShowPicker(true)}
            disabled={loading}
          >
            <View style={styles.currencyInfo}>
              <Text style={styles.currencyCode}>{selectedCurrency.code}</Text>
              <Text style={styles.currencyLabel}>{selectedCurrency.label}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleProfileSave}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.buttonText}>Siguiente →</Text>
            }
          </TouchableOpacity>
        </View>

        <Modal visible={showPicker} animationType="slide" transparent>
          <SafeAreaView style={styles.backdrop}>
            <View style={styles.sheet}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>Selecciona tu moneda</Text>
                <TouchableOpacity onPress={() => setShowPicker(false)}>
                  <Text style={styles.closeButton}>Cerrar</Text>
                </TouchableOpacity>
              </View>
              <FlatList
                data={CURRENCIES}
                keyExtractor={item => item.code}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.option}
                    onPress={() => { setMoneda(item.code); setShowPicker(false); }}
                  >
                    <View>
                      <Text style={styles.optionCode}>{item.code}</Text>
                      <Text style={styles.optionLabel}>{item.label}</Text>
                    </View>
                    {moneda === item.code && (
                      <Text style={styles.checkmark}>✓</Text>
                    )}
                  </TouchableOpacity>
                )}
                ItemSeparatorComponent={() => <View style={styles.separator} />}
              />
            </View>
          </SafeAreaView>
        </Modal>
      </KeyboardAvoidingView>
    );
  }

  if (step === 'wow_input') {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.inner}>
          <Text style={styles.stepBadge}>Paso 2 de 2</Text>
          <Text style={styles.title}>Tu primer registro</Text>
          <Text style={styles.subtitle}>
            Solo tarda 10 segundos. Registra algo que hayas comprado hoy.
          </Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Text style={styles.label}>¿Qué compraste hoy?</Text>
          <TextInput
            style={styles.input}
            placeholder="Ej: Almuerzo, Café, Bus..."
            placeholderTextColor="#9CA3AF"
            autoCapitalize="sentences"
            value={wowItem}
            onChangeText={setWowItem}
          />

          <Text style={styles.label}>¿Cuánto costó? ({SYM[moneda] ?? moneda})</Text>
          <TextInput
            style={styles.input}
            placeholder="Ej: 25"
            placeholderTextColor="#9CA3AF"
            keyboardType="decimal-pad"
            value={wowAmount}
            onChangeText={setWowAmount}
          />

          <TouchableOpacity style={styles.button} onPress={handleWowSubmit}>
            <Text style={styles.buttonText}>Ver el impacto ✨</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // step === 'wow_impact'
  const amount = parseFloat(wowAmount.replace(',', '.')) || 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: '#F9FAFB' }}
      contentContainerStyle={styles.impactContainer}
      keyboardShouldPersistTaps="handled"
    >
      <ImpactBanner
        item={wowItem}
        amount={amount}
        currency={moneda}
      />

      <TouchableOpacity
        style={[styles.button, styles.finishButton, loading && styles.buttonDisabled]}
        onPress={handleFinish}
        disabled={loading}
      >
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.buttonText}>¡Empezar a usarla! 🚀</Text>
        }
      </TouchableOpacity>

      <Text style={styles.finishNote}>
        Tu gasto quedará guardado en el historial.
      </Text>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  centerContainer: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  impactContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 40,
  },

  // Welcome
  wowEmoji: {
    fontSize: 64,
    marginBottom: 20,
    textAlign: 'center',
  },
  wowTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 12,
  },
  wowSubtitle: {
    fontSize: 17,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 26,
    marginBottom: 40,
  },

  // Step badge
  stepBadge: {
    fontSize: 12,
    fontWeight: '600',
    color: '#7C3AED',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },

  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 28,
    lineHeight: 21,
  },
  error: {
    backgroundColor: '#FEE2E2',
    color: '#DC2626',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    fontSize: 14,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 6,
  },
  input: {
    height: 52,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#111827',
    marginBottom: 16,
  },

  // Currency picker
  currencyButton: {
    height: 52,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 32,
  },
  currencyInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  currencyCode: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  currencyLabel: {
    fontSize: 15,
    color: '#6B7280',
  },
  chevron: {
    fontSize: 20,
    color: '#9CA3AF',
  },

  // Buttons
  button: {
    height: 52,
    backgroundColor: '#3B82F6',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  finishButton: {
    backgroundColor: '#7C3AED',
    marginTop: 24,
  },
  finishNote: {
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 14,
  },

  // Impact banner
  bannerCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#7C3AED',
  },
  bannerEmoji: {
    fontSize: 36,
    marginBottom: 12,
    textAlign: 'center',
  },
  bannerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 14,
  },
  bannerText: {
    fontSize: 15,
    color: '#374151',
    lineHeight: 24,
    marginBottom: 20,
    textAlign: 'center',
  },
  bannerBold: {
    fontWeight: '700',
    color: '#111827',
  },
  barBg: {
    height: 10,
    backgroundColor: '#F3F4F6',
    borderRadius: 5,
    overflow: 'hidden',
    marginBottom: 6,
  },
  barFill: {
    height: '100%',
    borderRadius: 5,
  },
  barLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  barLabel: {
    fontSize: 11,
    color: '#9CA3AF',
  },

  // Currency modal
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '60%',
    paddingBottom: 24,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  closeButton: {
    fontSize: 15,
    color: '#3B82F6',
    fontWeight: '500',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  optionCode: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  optionLabel: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 1,
  },
  checkmark: {
    fontSize: 18,
    color: '#3B82F6',
    fontWeight: '600',
  },
  separator: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginHorizontal: 20,
  },
});
