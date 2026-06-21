import { useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, ActivityIndicator,
  TouchableOpacity, SafeAreaView,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { supabase } from '@/lib/supabase';

interface Tx {
  id: string;
  monto: number;
  descripcion: string | null;
  creado_en: string;
  moneda: string | null;
  tipo_cambio: number | null;
}

const SYM: Record<string, string> = {
  PEN: 'S/', USD: '$', EUR: '€', BRL: 'R$', COP: '$', MXN: '$', ARS: '$', CLP: '$',
};
const ICON: Record<string, string> = {
  Alimentación: '🛒', Transporte: '🚗', Vivienda: '🏠', Entretenimiento: '🎬',
  Salud: '💊', Educación: '📚', Ropa: '👕', Servicios: '⚡',
  Restaurantes: '🍽️', Otros: '📦',
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
}

export default function CategoriaDetalle() {
  const { categoria, presupuesto, moneda: monedaParam } = useLocalSearchParams<{
    categoria: string; presupuesto: string; moneda: string;
  }>();

  const [txs,     setTxs]     = useState<Tx[]>([]);
  const [loading, setLoading] = useState(true);

  const limite  = parseFloat(presupuesto ?? '0');
  const moneda  = monedaParam ?? 'PEN';
  const sym     = SYM[moneda] ?? moneda;
  const icon    = ICON[categoria ?? ''] ?? '📦';

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const now           = new Date();
      const startOfMonth  = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      const { data } = await supabase
        .from('transacciones')
        .select('id,monto,descripcion,creado_en,moneda,tipo_cambio')
        .eq('user_id', user.id)
        .eq('tipo', 'gasto')
        .eq('categoria', categoria)
        .eq('activo', true)
        .gte('creado_en', startOfMonth)
        .order('creado_en', { ascending: false });

      setTxs((data as Tx[]) ?? []);
      setLoading(false);
    })();
  }, [categoria]);

  // Convert each transaction to base currency before summing
  const toPEN = (t: Tx) => {
    const mon = t.moneda ?? 'PEN';
    if (mon === 'PEN') return t.monto;
    return t.monto * (t.tipo_cambio ?? 1);
  };
  const total = txs.reduce((s, t) => s + toPEN(t), 0);
  const pct      = limite > 0 ? Math.min(total / limite, 1) : 0;
  const pctColor = pct >= 0.9 ? '#DC2626' : pct >= 0.7 ? '#F59E0B' : '#22C55E';
  const remaining = Math.max(limite - total, 0);

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backArrow}>←</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerIcon}>{icon}</Text>
          <Text style={s.headerTitle}>{categoria}</Text>
        </View>
      </View>

      {/* Resumen */}
      <View style={s.summary}>
        <View style={s.summaryRow}>
          <View style={s.summaryItem}>
            <Text style={s.summaryLabel}>Gastado</Text>
            <Text style={[s.summaryValue, { color: pctColor }]}>
              {sym} {total.toFixed(2)}
            </Text>
          </View>
          {limite > 0 && (
            <>
              <View style={s.summaryDivider} />
              <View style={s.summaryItem}>
                <Text style={s.summaryLabel}>Límite</Text>
                <Text style={s.summaryValue}>{sym} {limite.toFixed(2)}</Text>
              </View>
              <View style={s.summaryDivider} />
              <View style={s.summaryItem}>
                <Text style={s.summaryLabel}>Disponible</Text>
                <Text style={[s.summaryValue, { color: '#22C55E' }]}>
                  {sym} {remaining.toFixed(2)}
                </Text>
              </View>
            </>
          )}
        </View>

        {limite > 0 && (
          <>
            <View style={s.barBg}>
              <View style={[s.barFill, { width: `${pct * 100}%` as any, backgroundColor: pctColor }]} />
            </View>
            <Text style={[s.pctLabel, { color: pctColor }]}>
              {Math.round(pct * 100)}% del presupuesto mensual usado
            </Text>
          </>
        )}
      </View>

      {/* Lista */}
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color="#7C3AED" />
      ) : txs.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyIcon}>🎉</Text>
          <Text style={s.emptyText}>Sin gastos este mes en {categoria}</Text>
        </View>
      ) : (
        <FlatList
          data={txs}
          keyExtractor={t => t.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          ItemSeparatorComponent={() => <View style={s.sep} />}
          ListHeaderComponent={
            <Text style={s.listHeader}>{txs.length} gasto{txs.length !== 1 ? 's' : ''} este mes</Text>
          }
          renderItem={({ item }) => (
            <View style={s.txRow}>
              <View style={s.txLeft}>
                <Text style={s.txDesc} numberOfLines={1}>
                  {item.descripcion ?? categoria}
                </Text>
                <Text style={s.txDate}>{fmtDate(item.creado_en)} · {fmtTime(item.creado_en)}</Text>
              </View>
              <Text style={s.txAmt}>
                -{SYM[item.moneda ?? 'PEN'] ?? item.moneda ?? 'S/'} {item.monto.toFixed(2)}
                {item.moneda && item.moneda !== 'PEN' ? ` ${item.moneda}` : ''}
              </Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#F9FAFB' },

  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  backBtn:{ paddingRight: 16, paddingVertical: 4 },
  backArrow: { fontSize: 22, color: '#374151' },
  headerIcon:  { fontSize: 28, marginBottom: 2 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#111827' },

  summary:      { backgroundColor: '#fff', margin: 16, borderRadius: 16, padding: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  summaryRow:   { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 14 },
  summaryItem:  { alignItems: 'center', flex: 1 },
  summaryLabel: { fontSize: 11, color: '#9CA3AF', fontWeight: '500', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  summaryValue: { fontSize: 17, fontWeight: '700', color: '#111827' },
  summaryDivider: { width: 1, backgroundColor: '#F3F4F6' },

  barBg:    { height: 8, backgroundColor: '#F3F4F6', borderRadius: 4, overflow: 'hidden', marginBottom: 6 },
  barFill:  { height: '100%', borderRadius: 4 },
  pctLabel: { fontSize: 11, textAlign: 'center', fontWeight: '600' },

  listHeader: { fontSize: 12, fontWeight: '600', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 },

  txRow:  { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 14 },
  txLeft: { flex: 1, marginRight: 12 },
  txDesc: { fontSize: 15, fontWeight: '500', color: '#111827', marginBottom: 3 },
  txDate: { fontSize: 12, color: '#9CA3AF' },
  txAmt:  { fontSize: 15, fontWeight: '700', color: '#DC2626' },
  sep:    { height: 6 },

  empty:     { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 60 },
  emptyIcon: { fontSize: 40, marginBottom: 10 },
  emptyText: { fontSize: 15, color: '#6B7280', textAlign: 'center' },
});
