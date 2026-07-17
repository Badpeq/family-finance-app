import { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, SafeAreaView } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import TransactionsList from '@/components/TransactionsList';
import { supabase } from '@/lib/supabase';
import { T, MAXW } from '@/theme';

export default function Transacciones() {
  const [pendingCount, setPendingCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { count } = await supabase
          .from('transacciones')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('estado', 'PENDIENTE_REVISION')
          .eq('activo', true);
        setPendingCount(count ?? 0);
      })();
    }, []),
  );

  return (
    <View style={s.root}>
      <SafeAreaView style={s.safe}>
        <View style={s.constrain}>
          <View style={s.header}>
            <Text style={s.title}>Movimientos</Text>
            <TouchableOpacity style={s.importBtn} onPress={() => router.push('/importar')}>
              <Ionicons name="download-outline" size={15} color={T.accentDark} />
              <Text style={s.importText}>Importar</Text>
            </TouchableOpacity>
          </View>

          {pendingCount > 0 && (
            <TouchableOpacity style={s.banner} onPress={() => router.push('/pendientes')}>
              <Ionicons name="notifications-outline" size={15} color={T.amber} />
              <Text style={s.bannerText}>
                {pendingCount} gasto{pendingCount > 1 ? 's' : ''} pendiente{pendingCount > 1 ? 's' : ''} de revisión
              </Text>
              <Ionicons name="chevron-forward" size={15} color={T.amber} />
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
      <TransactionsList />
    </View>
  );
}

const s = StyleSheet.create({
  root:      { flex: 1, backgroundColor: T.screen },
  safe:      { backgroundColor: T.card },
  constrain: { width: '100%', maxWidth: MAXW, alignSelf: 'center' },
  header:    {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'android' ? 44 : 12,
    paddingHorizontal: 16, paddingBottom: 12,
  },
  title:     { fontSize: 20, fontWeight: '800', color: T.textPrimary, letterSpacing: -0.3 },
  importBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: T.accentSoft, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 12,
  },
  importText: { fontSize: 13, fontWeight: '600', color: T.accentDark },
  banner:    {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A', borderRadius: 12,
    marginHorizontal: 16, marginBottom: 10, paddingHorizontal: 12, paddingVertical: 10,
  },
  bannerText: { flex: 1, fontSize: 13, fontWeight: '600', color: T.amber },
});
