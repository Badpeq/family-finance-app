import { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  Platform, SafeAreaView, TouchableOpacity,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';

interface MonthSummary {
  mes:      string;  // 'YYYY-MM'
  ingresos: number;
  gastos:   number;
  porCat:   Record<string, number>;
}

const SYM: Record<string, string> = {
  PEN: 'S/', USD: '$', EUR: '€', BRL: 'R$', COP: '$', MXN: '$', ARS: '$', CLP: '$',
};
const MONTHS_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function pct(a: number, b: number) {
  if (b === 0) return 0;
  return Math.round(((a - b) / b) * 100);
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const w = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <View style={s.miniBarBg}>
      <View style={[s.miniBarFill, { width: `${w}%` as any, backgroundColor: color }]} />
    </View>
  );
}

export default function Analisis() {
  const [summaries, setSummaries] = useState<MonthSummary[]>([]);
  const [currency,  setCurrency]  = useState('PEN');
  const [loading,   setLoading]   = useState(true);
  const [tab,       setTab]       = useState<'meses' | 'categorias'>('meses');

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !active) return;

        const [profRes, txRes] = await Promise.all([
          supabase.from('profiles').select('moneda_base').eq('id', user.id).single(),
          supabase.from('transacciones')
            .select('tipo,monto,categoria,creado_en,moneda,tipo_cambio')
            .eq('user_id', user.id)
            .eq('activo', true)
            .order('creado_en', { ascending: true }),
        ]);

        if (!active) return;
        const cur = (profRes.data as any)?.moneda_base ?? 'PEN';
        setCurrency(cur);

        const txs = (txRes.data ?? []) as any[];
        const byMonth: Record<string, MonthSummary> = {};

        txs.forEach(tx => {
          const mes = tx.creado_en.slice(0, 7);
          if (!byMonth[mes]) byMonth[mes] = { mes, ingresos: 0, gastos: 0, porCat: {} };
          const amt = Number(tx.monto);
          if (tx.tipo === 'ingreso') byMonth[mes].ingresos += amt;
          else {
            byMonth[mes].gastos += amt;
            byMonth[mes].porCat[tx.categoria] = (byMonth[mes].porCat[tx.categoria] ?? 0) + amt;
          }
        });

        const sorted = Object.values(byMonth).sort((a, b) => a.mes.localeCompare(b.mes));
        setSummaries(sorted);
        setLoading(false);
      })();
      return () => { active = false; };
    }, [])
  );

  const sym = SYM[currency] ?? currency;
  const fmt = (n: number) => `${sym} ${n.toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  // ── Insights ────────────────────────────────────────────────────────────────
  function generateInsights(): string[] {
    const insights: string[] = [];
    if (summaries.length < 2) return insights;

    const last  = summaries[summaries.length - 1];
    const prev  = summaries[summaries.length - 2];

    // Balance
    const balLast = last.ingresos - last.gastos;
    const balPrev = prev.ingresos - prev.gastos;
    if (balLast > balPrev) {
      insights.push(`✅ Tu balance en ${fmtMes(last.mes)} (${fmt(balLast)}) mejoró respecto a ${fmtMes(prev.mes)} (${fmt(balPrev)}).`);
    } else if (balLast < balPrev) {
      insights.push(`⚠️ Tu balance bajó de ${fmt(balPrev)} en ${fmtMes(prev.mes)} a ${fmt(balLast)} en ${fmtMes(last.mes)}. Revisa tus gastos.`);
    }

    // Gastos totales
    const gPct = pct(last.gastos, prev.gastos);
    if (Math.abs(gPct) >= 5) {
      const dir = gPct > 0 ? 'aumentaron' : 'bajaron';
      insights.push(`${gPct > 0 ? '📈' : '📉'} Tus gastos totales ${dir} un ${Math.abs(gPct)}% respecto al mes anterior.`);
    }

    // Por categoría
    const allCats = new Set([...Object.keys(last.porCat), ...Object.keys(prev.porCat)]);
    allCats.forEach(cat => {
      const a = last.porCat[cat] ?? 0;
      const b = prev.porCat[cat] ?? 0;
      if (b === 0 || a === 0) return;
      const diff = pct(a, b);
      if (diff >= 20) {
        insights.push(`📌 Gastaste un ${diff}% más en ${cat} que el mes pasado (${fmt(a)} vs ${fmt(b)}). Te sugerimos ajustar tu meta diaria.`);
      } else if (diff <= -20) {
        insights.push(`🎉 Redujiste un ${Math.abs(diff)}% en ${cat} respecto al mes anterior. ¡Buen trabajo!`);
      }
    });

    // Tasa de ahorro
    if (last.ingresos > 0) {
      const savRate = Math.round(((last.ingresos - last.gastos) / last.ingresos) * 100);
      if (savRate >= 20) insights.push(`💰 Tasa de ahorro: ${savRate}% en ${fmtMes(last.mes)}. ¡Estás dentro de la regla 50/30/20!`);
      else if (savRate > 0) insights.push(`💡 Tasa de ahorro: ${savRate}% en ${fmtMes(last.mes)}. La meta recomendada es 20%.`);
      else insights.push(`🚨 Tus gastos superaron tus ingresos en ${fmtMes(last.mes)}. Considera revisar tu presupuesto.`);
    }

    return insights.slice(0, 5);
  }

  function fmtMes(ym: string) {
    const [y, m] = ym.split('-');
    return `${MONTHS_ES[parseInt(m, 10) - 1]} ${y}`;
  }

  const maxGastos = Math.max(...summaries.map(s => s.gastos), 1);
  const maxIngresos = Math.max(...summaries.map(s => s.ingresos), 1);
  const insights = generateInsights();

  // Top categorías del último mes
  const lastMonth = summaries[summaries.length - 1];
  const topCats = lastMonth
    ? Object.entries(lastMonth.porCat).sort((a, b) => b[1] - a[1]).slice(0, 6)
    : [];

  return (
    <View style={{ flex: 1, backgroundColor: '#F8F9FB' }}>
      <SafeAreaView style={{ backgroundColor: '#F8F9FB' }}>
        <View style={s.header}>
          <Text style={s.title}>📈 Análisis</Text>
        </View>
      </SafeAreaView>

      {loading ? (
        <ActivityIndicator color="#3B82F6" style={{ marginTop: 60 }} />
      ) : summaries.length === 0 ? (
        <View style={s.empty}>
          <Text style={{ fontSize: 40, marginBottom: 12 }}>📊</Text>
          <Text style={s.emptyText}>Sin datos suficientes para analizar.{'\n'}Registra transacciones primero.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>

          {/* ── Tabs ── */}
          <View style={s.tabs}>
            {(['meses', 'categorias'] as const).map(t => (
              <TouchableOpacity key={t} style={[s.tab, tab === t && s.tabOn]} onPress={() => setTab(t)}>
                <Text style={[s.tabText, tab === t && s.tabTextOn]}>
                  {t === 'meses' ? 'Por mes' : 'Por categoría'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {tab === 'meses' && (
            <>
              {/* ── Comparativo mensual ── */}
              <View style={s.card}>
                <Text style={s.cardTitle}>Comparativo mensual {new Date().getFullYear()}</Text>
                {summaries.map((sum, i) => {
                  const bal = sum.ingresos - sum.gastos;
                  const balColor = bal >= 0 ? '#22C55E' : '#DC2626';
                  const prevSum = summaries[i - 1];
                  const gastDiff = prevSum ? pct(sum.gastos, prevSum.gastos) : null;
                  return (
                    <View key={sum.mes} style={[s.monthRow, i < summaries.length - 1 && s.monthRowBorder]}>
                      <View style={{ width: 48 }}>
                        <Text style={s.monthLabel}>{fmtMes(sum.mes)}</Text>
                      </View>
                      <View style={{ flex: 1, gap: 4 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={s.barLabelIn}>↑</Text>
                          <MiniBar value={sum.ingresos} max={maxIngresos} color="#22C55E" />
                          <Text style={s.barAmt}>{fmt(sum.ingresos)}</Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={s.barLabelOut}>↓</Text>
                          <MiniBar value={sum.gastos} max={maxGastos} color="#EF4444" />
                          <Text style={s.barAmt}>{fmt(sum.gastos)}</Text>
                        </View>
                      </View>
                      <View style={{ alignItems: 'flex-end', marginLeft: 8 }}>
                        <Text style={[s.balAmt, { color: balColor }]}>{bal >= 0 ? '+' : ''}{fmt(bal)}</Text>
                        {gastDiff !== null && (
                          <Text style={[s.diffLabel, { color: gastDiff > 0 ? '#EF4444' : '#22C55E' }]}>
                            {gastDiff > 0 ? '▲' : '▼'} {Math.abs(gastDiff)}%
                          </Text>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>

              {/* ── Insights ── */}
              {insights.length > 0 && (
                <View style={s.card}>
                  <Text style={s.cardTitle}>💡 Recomendaciones</Text>
                  {insights.map((insight, i) => (
                    <View key={i} style={[s.insightRow, i < insights.length - 1 && s.insightBorder]}>
                      <Text style={s.insightText}>{insight}</Text>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}

          {tab === 'categorias' && lastMonth && (
            <>
              <View style={s.card}>
                <Text style={s.cardTitle}>Top categorías — {fmtMes(lastMonth.mes)}</Text>
                {topCats.map(([cat, amt], i) => {
                  const maxCat = topCats[0][1];
                  const prevMonth = summaries[summaries.length - 2];
                  const prevAmt = prevMonth?.porCat[cat] ?? 0;
                  const diff = prevAmt > 0 ? pct(amt, prevAmt) : null;
                  return (
                    <View key={cat} style={[s.catRow, i < topCats.length - 1 && s.catRowBorder]}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                          <Text style={s.catName}>{cat}</Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            {diff !== null && (
                              <Text style={[s.diffLabel, { color: diff > 0 ? '#EF4444' : '#22C55E' }]}>
                                {diff > 0 ? '▲' : '▼'} {Math.abs(diff)}%
                              </Text>
                            )}
                            <Text style={s.catAmt}>{fmt(amt)}</Text>
                          </View>
                        </View>
                        <MiniBar value={amt} max={maxCat} color="#7C3AED" />
                        {prevAmt > 0 && (
                          <Text style={s.catPrevText}>Mes anterior: {fmt(prevAmt)}</Text>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>

              {/* Distribución porcentual */}
              {lastMonth.gastos > 0 && (
                <View style={s.card}>
                  <Text style={s.cardTitle}>Distribución del gasto</Text>
                  {topCats.map(([cat, amt]) => {
                    const p = Math.round((amt / lastMonth.gastos) * 100);
                    return (
                      <View key={cat} style={s.distRow}>
                        <Text style={s.distCat}>{cat}</Text>
                        <View style={s.distBar}>
                          <View style={[s.distFill, { width: `${p}%` as any }]} />
                        </View>
                        <Text style={s.distPct}>{p}%</Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: Platform.OS === 'android' ? 44 : 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  title:  { fontSize: 20, fontWeight: '800', color: '#111827' },

  empty:     { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyText: { fontSize: 15, color: '#6B7280', textAlign: 'center', lineHeight: 24 },

  tabs:       { flexDirection: 'row', backgroundColor: '#F3F4F6', borderRadius: 12, padding: 4, marginBottom: 16 },
  tab:        { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 10 },
  tabOn:      { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  tabText:    { fontSize: 13, fontWeight: '500', color: '#9CA3AF' },
  tabTextOn:  { color: '#111827', fontWeight: '700' },

  card:      { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 14, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#111827', marginBottom: 14 },

  monthRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  monthRowBorder: { borderBottomWidth: 1, borderBottomColor: '#F9FAFB' },
  monthLabel:     { fontSize: 12, fontWeight: '600', color: '#6B7280' },
  barLabelIn:     { fontSize: 12, color: '#22C55E', fontWeight: '700', width: 14 },
  barLabelOut:    { fontSize: 12, color: '#EF4444', fontWeight: '700', width: 14 },
  barAmt:         { fontSize: 11, color: '#9CA3AF', width: 72, textAlign: 'right' },
  balAmt:         { fontSize: 13, fontWeight: '700' },
  diffLabel:      { fontSize: 10, fontWeight: '600', marginTop: 2 },

  miniBarBg:   { flex: 1, height: 6, backgroundColor: '#F3F4F6', borderRadius: 3, overflow: 'hidden' },
  miniBarFill: { height: '100%', borderRadius: 3 },

  insightRow:    { paddingVertical: 10 },
  insightBorder: { borderBottomWidth: 1, borderBottomColor: '#F9FAFB' },
  insightText:   { fontSize: 13, color: '#374151', lineHeight: 20 },

  catRow:       { paddingVertical: 10 },
  catRowBorder: { borderBottomWidth: 1, borderBottomColor: '#F9FAFB' },
  catName:      { fontSize: 14, fontWeight: '600', color: '#111827' },
  catAmt:       { fontSize: 14, fontWeight: '700', color: '#374151' },
  catPrevText:  { fontSize: 11, color: '#9CA3AF', marginTop: 4 },

  distRow:  { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 },
  distCat:  { fontSize: 12, color: '#374151', width: 100 },
  distBar:  { flex: 1, height: 8, backgroundColor: '#F3F4F6', borderRadius: 4, overflow: 'hidden' },
  distFill: { height: '100%', backgroundColor: '#7C3AED', borderRadius: 4 },
  distPct:  { fontSize: 11, fontWeight: '600', color: '#7C3AED', width: 30, textAlign: 'right' },
});
