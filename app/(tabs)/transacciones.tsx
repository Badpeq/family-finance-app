import { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, SafeAreaView } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import TransactionsList from '@/components/TransactionsList';
import { supabase } from '@/lib/supabase';

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
        <View style={s.header}>
          <Text style={s.title}>Movimientos</Text>
          <TouchableOpacity style={s.importBtn} onPress={() => router.push('/importar')}>
            <Text style={s.importText}>📥 Importar</Text>
          </TouchableOpacity>
        </View>

        {pendingCount > 0 && (
          <TouchableOpacity style={s.banner} onPress={() => router.push('/pendientes')}>
            <Text style={s.bannerText}>
              🔔 {pendingCount} gasto{pendingCount > 1 ? 's' : ''} pendiente{pendingCount > 1 ? 's' : ''} de revisión →
            </Text>
          </TouchableOpacity>
        )}
      </SafeAreaView>
      <TransactionsList />
    </View>
  );
}

const s = StyleSheet.create({
  root:       { flex: 1, backgroundColor: '#F3F4F6' },
  safe:       { backgroundColor: '#fff' },
  header:     {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'android' ? 44 : 12,
    paddingHorizontal: 20, paddingBottom: 14,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  title:      { fontSize: 20, fontWeight: '800', color: '#111827' },
  importBtn:  { backgroundColor: '#EDE9FE', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  importText: { fontSize: 13, fontWeight: '600', color: '#5B21B6' },
  banner:     {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 20, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: '#FDE68A',
  },
  bannerText: { fontSize: 13, fontWeight: '600', color: '#92400E' },
});
