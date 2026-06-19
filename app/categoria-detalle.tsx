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
  fecha: string | null;
  creado_en: string;
  moneda: string;
  es_gasto_unico: boolean | null;
  subcategoria_id: string | null;
  subcategorias: { nombre: string } | null;
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
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-PE', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export default function CategoriaDetalle() {
  const { categoria, presupuesto, moneda: monedaParam } = useLocalSearchParams<{
    categoria: string; presupuesto: string; moneda: string;
  }>();

  const [txs,     setTxs]     = useState<Tx[]>([]);
  const [loading, setLoading] = useState(true);

  const limite = parseFloat(presupuesto ?? '0');
  const moneda = monedaParam ?? 'PEN';
  const sym    = SYM[moneda] ?? moneda;
  const icon   = ICON[categoria ?? ''] ?? '📦';

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const now         = new Date();
      const periodoDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

      const { data } = await supabase
        .from('transacciones')
        .select('id,monto,descripcion,fecha,creado_en,moneda,es_gasto_unico,subcategoria_id,subcategorias(nombre)')
        .eq('user_id', user.id)
        .eq('tipo', 'gasto')
        .eq('categoria', categoria)
        .eq('activo', true)
        .gte('fecha', periodoDate)
        .order('fecha', { ascending: false });

      setTxs((data as unknown as Tx[]) ?? []);
      setLoading(false);
    })();
  }, [categoria]);

  const total     = txs.reduce((s, t) => s + t.monto, 0);
  const pct       = limite > 0 ? Math.min(total / limite, 1) : 0;
  const pctColor  = pct >= 0.9 ? '#DC2626' : pct >= 0.7 ? '#F59E0B' : '#22C55E';
  const remaining = Math.max(limite - total, 0);

  const unicosTotal = txs
    .filter(t => t.es_gasto_unico)
    .reduce((s, t) => s + t.monto, 0);

  // Subcategory aggregation for micro-bars
  const subcatMap: Record<string, number> = {};
  for (const t of txs) {
    const name = t.subcategorias?.nombre;
    if (name) subcatMap[name] = (subcatMap[name] ?? 0) + t.monto;
  }
  const subcatEntries = Object.entries(subcatMap).sort((a, b) => b[1] - a[1]);
  const subcatMax = subcatEntries[0]?.[1] ?? 1;

  const ListHeader = () => (
    <>
      {/* Resumen card */}
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
              <View style={[s.barFill, { width: `${Math.round(pct * 100)}%` as any, backgroundColor: pctColor }]} />
            </View>
            <Text style={[s.pctLabel, { color: pctColor }]}>
              {Math.round(pct * 100)}% del presupuesto mensual
            </Text>
          </>
        )}

        {unicosTotal > 0 && (
          <View style={s.unicoNote}>
            <Text style={s.unicoNoteText}>
              ⚡ {sym} {unicosTotal.toFixed(2)} son gastos únicos — no se proyectan al fin de mes
            </Text>
          </View>
        )}
      </View>

      {/* Subcategory micro-bars */}
      {subcatEntries.length > 0 && (
        <View style={s.subcatCard}>
          <Text style={s.subcatTitle}>Por subcategoría</Text>
          {subcatEntries.map(([nombre, amt]) => (
            <View key={nombre} style={s.subcatRow}>
              <View style={s.subcatRowHead}>
                <Text style={s.subcatName}>{nombre}</Text>
                <Text style={s.subcatAmt}>{sym} {amt.toFixed(2)}</Text>
              </View>
              <View style={s.subcatBarBg}>
                <View style={[s.subcatBarFill, {
                  width: `${Math.round((amt / subcatMax) * 100)}%` as any,
                }]} />
              </View>
            </View>
          ))}
        </View>
      )}

      <Text style={s.listHeader}>
        {txs.length} gasto{txs.length !== 1 ? 's' : ''} este mes
      </Text>
    </>
  );

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

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color="#7C3AED" />
      ) : (
        <FlatList
          data={txs}
          keyExtractor={t => t.id}
          contentContainerStyle={{ paddingBottom: 32 }}
          ItemSeparatorComponent={() => <View style={s.sep} />}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={s.emptyIcon}>🎉</Text>
              <Text style={s.emptyText}>Sin gastos este mes en {categoria}</Text>
            </View>
          }
          renderItem={({ item }) => {
            const displayDate = item.fecha ?? item.creado_en.slice(0, 10);
            const subcatName  = item.subcategorias?.nombre;
            return (
              <View style={s.txRow}>
                <View style={s.txLeft}>
                  <View style={s.txTitleRow}>
                    <Text style={s.txDesc} numberOfLines={1}>
                      {item.descripcion ?? categoria}
                    </Text>
                    {item.es_gasto_unico && (
                      <View style={s.unicoBadge}>
                        <Text style={s.unicoBadgeText}>⚡ único</Text>
                      </View>
                    )}
                  </View>
                  <Text style={s.txDate}>
                    {fmtDate(displayDate)}{subcatName ? ` · ${subcatName}` : ''}
                  </Text>
                </View>
                <Text style={s.txAmt}>
                  -{SYM[item.moneda] ?? item.moneda} {item.monto.toFixed(2)}
                </Text>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F9FAFB' },

  header:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  backBtn:     { paddingRight: 16, paddingVertical: 4 },
  backArrow:   { fontSize: 22, color: '#374151' },
  headerIcon:  { fontSize: 28, marginBottom: 2 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#111827' },

  summary:        { backgroundColor: '#fff', margin: 16, borderRadius: 16, padding: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  summaryRow:     { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 14 },
  summaryItem:    { alignItems: 'center', flex: 1 },
  summaryLabel:   { fontSize: 11, color: '#9CA3AF', fontWeight: '500', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  summaryValue:   { fontSize: 17, fontWeight: '700', color: '#111827' },
  summaryDivider: { width: 1, backgroundColor: '#F3F4F6' },
  barBg:          { height: 8, backgroundColor: '#F3F4F6', borderRadius: 4, overflow: 'hidden', marginBottom: 6 },
  barFill:        { height: '100%' as any, borderRadius: 4 },
  pctLabel:       { fontSize: 11, textAlign: 'center', fontWeight: '600' },

  unicoNote:     { marginTop: 10, backgroundColor: '#FEF9C3', borderRadius: 8, padding: 8 },
  unicoNoteText: { fontSize: 12, color: '#92400E', fontWeight: '500', lineHeight: 17 },

  subcatCard:    { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 12, borderRadius: 16, padding: 16, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  subcatTitle:   { fontSize: 11, fontWeight: '700', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12 },
  subcatRow:     { marginBottom: 10 },
  subcatRowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  subcatName:    { fontSize: 13, color: '#374151', fontWeight: '500' },
  subcatAmt:     { fontSize: 13, color: '#111827', fontWeight: '700' },
  subcatBarBg:   { height: 5, backgroundColor: '#F3F4F6', borderRadius: 3, overflow: 'hidden' },
  subcatBarFill: { height: '100%' as any, backgroundColor: '#7C3AED', borderRadius: 3 },

  listHeader: { fontSize: 11, fontWeight: '700', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10, paddingHorizontal: 16, paddingTop: 4 },

  txRow:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 14, marginHorizontal: 16 },
  txLeft:     { flex: 1, marginRight: 12 },
  txTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 3 },
  txDesc:     { fontSize: 15, fontWeight: '500', color: '#111827', flexShrink: 1 },
  txDate:     { fontSize: 12, color: '#9CA3AF' },
  txAmt:      { fontSize: 15, fontWeight: '700', color: '#DC2626' },
  sep:        { height: 6 },

  unicoBadge:     { backgroundColor: '#FEF9C3', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  unicoBadgeText: { fontSize: 10, fontWeight: '700', color: '#92400E' },

  empty:     { alignItems: 'center', paddingTop: 60 },
  emptyIcon: { fontSize: 40, marginBottom: 10 },
  emptyText: { fontSize: 15, color: '#6B7280', textAlign: 'center' },
});
