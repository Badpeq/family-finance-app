import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
  FlatList,
  SafeAreaView,
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';

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

export default function Onboarding() {
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [moneda, setMoneda] = useState('PEN');
  const [showPicker, setShowPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id ?? null);
    });
  }, []);

  const selectedCurrency = CURRENCIES.find(c => c.code === moneda)!;

  const handleSave = async () => {
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
        nombre: nombre.trim(),
        apellido: apellido.trim(),
        moneda_base: moneda,
        perfil_completado: true,
      })
      .eq('id', userId);

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.replace('/(tabs)');
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Completa tu perfil</Text>
        <Text style={styles.subtitle}>
          Esta información personaliza tu experiencia financiera.
        </Text>

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
          onPress={handleSave}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>Guardar Perfil</Text>
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
                  onPress={() => {
                    setMoneda(item.code);
                    setShowPicker(false);
                  }}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: '#6B7280',
    marginBottom: 32,
    lineHeight: 22,
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
  button: {
    height: 52,
    backgroundColor: '#3B82F6',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  // Modal
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
