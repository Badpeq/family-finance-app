import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Link } from 'expo-router';
import { supabase } from '@/lib/supabase';

export default function Register() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    const sanitizedPhone = phone.replace(/\s+/g, '');

    if (!sanitizedPhone || !password.trim() || !confirm.trim()) {
      setError('Completa todos los campos.');
      return;
    }

    if (!sanitizedPhone.startsWith('+')) {
      setError('El número debe incluir el código de país (ej: +51987654321).');
      return;
    }

    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    setError('');
    setLoading(true);

    const { error } = await supabase.auth.signUp({ phone: sanitizedPhone, password });

    if (error) {
      setError(error.message);
    }

    setLoading(false);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.inner}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Crear cuenta</Text>
        <Text style={styles.subtitle}>Registra tu número de celular con código de país</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.label}>Número de celular</Text>
        <TextInput
          style={styles.input}
          placeholder="+51 987 654 321"
          placeholderTextColor="#9CA3AF"
          keyboardType="phone-pad"
          autoComplete="tel"
          value={phone}
          onChangeText={setPhone}
          editable={!loading}
        />

        <Text style={styles.label}>Contraseña</Text>
        <TextInput
          style={styles.input}
          placeholder="Mínimo 6 caracteres"
          placeholderTextColor="#9CA3AF"
          secureTextEntry
          autoComplete="new-password"
          value={password}
          onChangeText={setPassword}
          editable={!loading}
        />

        <Text style={styles.label}>Confirmar contraseña</Text>
        <TextInput
          style={styles.input}
          placeholder="Repite tu contraseña"
          placeholderTextColor="#9CA3AF"
          secureTextEntry
          autoComplete="new-password"
          value={confirm}
          onChangeText={setConfirm}
          editable={!loading}
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleRegister}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>Registrarme</Text>
          }
        </TouchableOpacity>

        <View style={styles.footer}>
          <Text style={styles.footerText}>¿Ya tienes cuenta? </Text>
          <Link href="/(auth)/login" style={styles.link}>Inicia sesión</Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  inner: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 48,
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
  button: {
    height: 52,
    backgroundColor: '#3B82F6',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 24,
  },
  footerText: {
    color: '#6B7280',
    fontSize: 14,
  },
  link: {
    color: '#3B82F6',
    fontSize: 14,
    fontWeight: '600',
  },
});
