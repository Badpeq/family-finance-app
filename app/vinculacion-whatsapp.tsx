/**
 * Pantalla: Configuración de WhatsApp
 * Permite al usuario vincular su número de WhatsApp para recibir
 * capturas de Yape/Plin y registrar gastos automáticamente.
 *
 * Acceso: (tabs)/mas.tsx → "WhatsApp automático"
 */

import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';

const C = {
  hero:    '#080C10',
  screen:  '#F7F8FA',
  card:    '#FFFFFF',
  accent:  '#3B82F6',
  success: '#22C55E',
  danger:  '#EF4444',
  text:    '#111827',
  muted:   '#6B7280',
  border:  '#E5E7EB',
};

// Número de WhatsApp Business configurado en la app (se puede mover a .env)
const WA_BUSINESS_NUMBER = '51900000000'; // ← Reemplazar con tu número real

export default function VinculacionWhatsApp() {
  const [telefono, setTelefono]   = useState('');
  const [vinculado, setVinculado] = useState<string | null>(null);
  const [pendientes, setPendientes] = useState(0);
  const [saving, setSaving]       = useState(false);
  const [loading, setLoading]     = useState(true);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;

        // Cargar teléfono WA actual del perfil
        const { data: profile } = await supabase
          .from('profiles')
          .select('telefono_whatsapp')
          .eq('id', user.id)
          .single();

        // Contar transacciones pendientes de clasificar
        const { count } = await supabase
          .from('transacciones')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('categoria', 'Por clasificar')
          .eq('activo', true);

        if (!cancelled) {
          setVinculado(profile?.telefono_whatsapp ?? null);
          setTelefono(profile?.telefono_whatsapp ?? '');
          setPendientes(count ?? 0);
          setLoading(false);
        }
      })();
      return () => { cancelled = true; };
    }, []),
  );

  const handleGuardar = async () => {
    const num = telefono.replace(/\D/g, '');
    if (num.length < 9) {
      Alert.alert('Número inválido', 'Ingresa un número de celular peruano (9 dígitos).');
      return;
    }
    // Normalizar a E.164 sin '+': '51' + 9 dígitos
    const normalizado = num.startsWith('51') ? num : `51${num}`;

    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('profiles')
      .update({ telefono_whatsapp: normalizado })
      .eq('id', user!.id);

    setSaving(false);
    if (error) {
      if (error.code === '23505') {
        Alert.alert('Número ya registrado', 'Este número ya está vinculado a otra cuenta.');
      } else {
        Alert.alert('Error', error.message);
      }
      return;
    }
    setVinculado(normalizado);
    Alert.alert(
      '¡Listo!',
      `Tu número +${normalizado} está vinculado.\n\nAhora comparte tus capturas de Yape o Plin al número de WhatsApp de la app.`,
    );
  };

  const handleDesvincular = () => {
    Alert.alert(
      'Desvincular WhatsApp',
      '¿Seguro que quieres desvincular tu número? Ya no podrás registrar gastos por WhatsApp.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Desvincular',
          style: 'destructive',
          onPress: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            await supabase
              .from('profiles')
              .update({ telefono_whatsapp: null })
              .eq('id', user!.id);
            setVinculado(null);
            setTelefono('');
          },
        },
      ],
    );
  };

  const abrirWhatsApp = () => {
    Linking.openURL(`https://wa.me/${WA_BUSINESS_NUMBER}`);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>

      {/* Hero */}
      <View style={styles.hero}>
        <Text style={styles.heroIcon}>💬</Text>
        <Text style={styles.heroTitle}>WhatsApp automático</Text>
        <Text style={styles.heroSub}>
          Comparte tus capturas de Yape o Plin directamente a WhatsApp y registra gastos sin abrir la app.
        </Text>
      </View>

      {/* Badge de pendientes */}
      {pendientes > 0 && (
        <TouchableOpacity style={styles.pendientesBanner}>
          <Ionicons name="alert-circle" size={18} color="#92400E" />
          <Text style={styles.pendientesText}>
            {pendientes} gasto{pendientes > 1 ? 's' : ''} sin categoría — tócalo para clasificar
          </Text>
          <Ionicons name="chevron-forward" size={16} color="#92400E" />
        </TouchableOpacity>
      )}

      {/* Card: estado de vinculación */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Tu número de WhatsApp</Text>

        <View style={styles.inputRow}>
          <Text style={styles.prefix}>+51</Text>
          <TextInput
            style={styles.input}
            value={telefono.replace(/^51/, '')}
            onChangeText={t => setTelefono(t.replace(/\D/g, ''))}
            placeholder="987 654 321"
            placeholderTextColor={C.muted}
            keyboardType="phone-pad"
            maxLength={9}
          />
          {vinculado && (
            <Ionicons name="checkmark-circle" size={22} color={C.success} style={{ marginLeft: 8 }} />
          )}
        </View>

        {vinculado ? (
          <View style={styles.vinculadoRow}>
            <View style={[styles.badge, { backgroundColor: '#DCFCE7' }]}>
              <Ionicons name="wifi" size={14} color={C.success} />
              <Text style={[styles.badgeText, { color: '#166534' }]}>Vinculado</Text>
            </View>
            <TouchableOpacity onPress={handleDesvincular}>
              <Text style={styles.desvincularLink}>Desvincular</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.btn, saving && styles.btnDisabled]}
            onPress={handleGuardar}
            disabled={saving}
          >
            {saving
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.btnText}>Vincular número</Text>
            }
          </TouchableOpacity>
        )}
      </View>

      {/* Instrucciones */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Cómo usarlo</Text>
        {STEPS.map((step, i) => (
          <View key={i} style={styles.step}>
            <View style={styles.stepNum}>
              <Text style={styles.stepNumText}>{i + 1}</Text>
            </View>
            <Text style={styles.stepText}>{step}</Text>
          </View>
        ))}
      </View>

      {/* Botón de abrir WhatsApp */}
      <TouchableOpacity style={styles.waBtn} onPress={abrirWhatsApp}>
        <Ionicons name="logo-whatsapp" size={20} color="#fff" />
        <Text style={styles.waBtnText}>Abrir chat de la app en WhatsApp</Text>
      </TouchableOpacity>

      {/* Info de privacidad */}
      <Text style={styles.privacidad}>
        🔒 Solo tú puedes enviar imágenes desde tu número. Ningún tercero puede registrar gastos en tu cuenta.
      </Text>

    </ScrollView>
  );
}

const STEPS = [
  'Realiza tu pago con Yape o Plin normalmente.',
  'En la confirmación del pago, toca "Compartir" o toma una captura de pantalla.',
  'Envía la imagen al número de WhatsApp de la app (botón abajo).',
  'En segundos recibirás confirmación y el gasto quedará registrado.',
  'Abre la app cuando quieras para asignarle una categoría.',
];

const styles = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: C.screen },
  content: { padding: 16, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  hero: {
    backgroundColor: C.hero,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
  },
  heroIcon:  { fontSize: 40, marginBottom: 10 },
  heroTitle: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 8 },
  heroSub:   { fontSize: 14, color: '#94A3B8', textAlign: 'center', lineHeight: 20 },

  pendientesBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    gap: 8,
  },
  pendientesText: { flex: 1, fontSize: 13, color: '#92400E', fontWeight: '500' },

  card:      { backgroundColor: C.card, borderRadius: 16, padding: 16, marginBottom: 12 },
  cardLabel: { fontSize: 13, color: C.muted, marginBottom: 10, fontWeight: '500' },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 48,
    marginBottom: 12,
  },
  prefix: { fontSize: 16, color: C.text, marginRight: 6, fontWeight: '500' },
  input:  { flex: 1, fontSize: 16, color: C.text },

  vinculadoRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge:          { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText:      { fontSize: 12, fontWeight: '600' },
  desvincularLink:{ fontSize: 13, color: C.danger, fontWeight: '500' },

  btn: {
    backgroundColor: C.accent,
    borderRadius: 10,
    height: 46,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  btnText:     { color: '#fff', fontWeight: '600', fontSize: 15 },

  sectionTitle: { fontSize: 15, fontWeight: '700', color: C.text, marginBottom: 14 },
  step:         { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12, gap: 10 },
  stepNum:      { width: 24, height: 24, borderRadius: 12, backgroundColor: C.accent, justifyContent: 'center', alignItems: 'center' },
  stepNumText:  { color: '#fff', fontSize: 12, fontWeight: '700' },
  stepText:     { flex: 1, fontSize: 14, color: C.text, lineHeight: 20 },

  waBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#25D366',
    borderRadius: 12,
    height: 50,
    gap: 8,
    marginBottom: 16,
  },
  waBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  privacidad: { fontSize: 12, color: C.muted, textAlign: 'center', lineHeight: 18 },
});
