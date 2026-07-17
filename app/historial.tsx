import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { router } from 'expo-router';
import TransactionsList from '@/components/TransactionsList';
import { T, MAXW } from '@/theme';

export default function Historial() {
  return (
    <View style={s.root}>
      <View style={s.headerWrap}>
        <View style={[s.header, s.constrain]}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Text style={s.backText}>‹ Volver</Text>
          </TouchableOpacity>
          <Text style={s.title}>Historial</Text>
          <View style={{ width: 70 }} />
        </View>
      </View>
      <TransactionsList />
    </View>
  );
}

const s = StyleSheet.create({
  root:      { flex: 1, backgroundColor: T.screen },
  constrain: { width: '100%', maxWidth: MAXW, alignSelf: 'center' },
  headerWrap:{ backgroundColor: T.card, borderBottomWidth: 1, borderBottomColor: T.border },
  header:    {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'android' ? 44 : 52,
    paddingHorizontal: 20, paddingBottom: 14,
  },
  backBtn:   { width: 70 },
  backText:  { fontSize: 16, color: T.accent, fontWeight: '500' },
  title:     { fontSize: 18, fontWeight: '700', color: T.textPrimary },
});
