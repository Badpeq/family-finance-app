import { View, Text, TouchableOpacity, StyleSheet, Platform, SafeAreaView } from 'react-native';
import { router } from 'expo-router';
import TransactionsList from '@/components/TransactionsList';

export default function Transacciones() {
  return (
    <View style={s.root}>
      <SafeAreaView style={s.safe}>
        <View style={s.header}>
          <Text style={s.title}>Movimientos</Text>
          <TouchableOpacity style={s.importBtn} onPress={() => router.push('/importar')}>
            <Text style={s.importText}>📥 Importar</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
      <TransactionsList />
    </View>
  );
}

const s = StyleSheet.create({
  root:      { flex: 1, backgroundColor: '#F3F4F6' },
  safe:      { backgroundColor: '#fff' },
  header:    {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'android' ? 44 : 12,
    paddingHorizontal: 20, paddingBottom: 14,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  title:     { fontSize: 20, fontWeight: '800', color: '#111827' },
  importBtn: { backgroundColor: '#EDE9FE', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  importText:{ fontSize: 13, fontWeight: '600', color: '#5B21B6' },
});
