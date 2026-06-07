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
} from 'react-native';
import { Link } from 'expo-router';
import { supabase } from '@/lib/supabase';

export default function Login() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    const sanitizedPhone = phone.replace(/\s+/g, '');

    if (!sanitizedPhone || !password.trim()) {
      setError('Completa todos los campos.');
      return;
    }

    if (!sanitizedPhone.startsWith('+')) {
      setError('El número debe incluir el código de país (ej: +51987654321).');
      return;
    }

    setError('');
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ phone: sanitizedPhone, password });

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
      <View style={styles.inner}>
        <Text style={styles.title}>Bienvenido</Text>
        <Text style={styles.subtitle}>Ingresa con tu número de celular</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

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

        <TextInput
          style={styles.input}
          placeholder="Contraseña"
          placeholderTextColor="#9CA3AF"
          secureTextEntry
          autoComplete="current-password"
          value={password}
          onChangeText={setPassword}
          editable={!loading}
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>Ingresar</Text>
          }
        </TouchableOpacity>

        <View style={styles.footer}>
          <Text style={styles.footerText}>¿No tienes cuenta? </Text>
          <Link href="/(auth)/register" style={styles.link}>Regístrate</Link>
        </View>
      </View>
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
  },
  error: {
    backgroundColor: '#FEE2E2',
    color: '#DC2626',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    fontSize: 14,
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
    marginBottom: 12,
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
