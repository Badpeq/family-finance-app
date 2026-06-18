import { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  Platform, SafeAreaView, TouchableOpacity,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { ICON_MAP } from '@/hooks/useCategorias';

interface MonthSummary {
  mes:      string;
  ingresos: number;
  gastos:   number;
  porCat:   Record<string, number>;
}

interface ProductoPrecio {
  producto:  string;
  historia:  { mes: string; precio: number }[];
  precioUlt: number;
  precioAvg: number;
  pctChange: number;
  alerta:    boolean;
}

interface DeudaCapa {
  categoria:           string;
  deuda_real:          number;
  deuda_presupuestada: number;
  deuda_proyectada:    number;
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

function Sparkline({ values, alerta }: { values: number[]; alerta: boolean }) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const H = 28;
  const BAR_W = 10;
  const GAP   = 4;
  const color = alerta ? '#EF4444' : '#7C3AED';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: H, gap: GAP }}>
      {values.map((v, i) => {
        const h = Math.max(4, ((v - min) / range) * H);
        const isLast = i === values.length - 1;
        return (
          <View key={i} style={{
            width: BAR_W, height: h, borderRadius: 3,
            backgroundColor: isLast ? color : color + '55',
          }} />
        );
      })}
    </View>
  );
}

export default function Analisis() {
  const [summaries,   setSummaries]   = useState<MonthSummary[]>([]);
  const [productos,   setProductos]   = useState<ProductoPrecio[]>([]);
  const [deudaCapas,  setDeudaCapas]  = useState<DeudaCapa[]>([]);
  const [loadingDeuda,setLoadingDeuda]= useState(false);
  const [currency,    setCurrency]    = useState('PEN');
  const [loading,     setLoading]     = useState(true);
  const [tab,         setTab]         = useState<'meses' | 'categorias' | 'precios' | 'deuda'>('meses');
  const [mesDeuda,    setMesDeuda]    = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2,'0')}-01`;
  });

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !active) return;

        const [profRes, txRes, detRes] = await Promise.all([
          supabase.from('profiles').select('moneda_base').eq('id', user.id).single(),
          supabase.from('transacciones')
            .select('id,tipo,monto,categoria,creado_en,moneda,tipo_cambio')
            .eq('user_id', user.id)
            .eq('activo', true)
            .order('creado_en', { ascending: true }),
          supabase.from('transaccion_detalles')
            .select('producto,precio_unitario,transacciones!inner(creado_en,user_id)')
            .eq('transacciones.user_id', user.id),
        ]);

        if (!active) return;
        const cur = (profRes.data as any)?.moneda_base ?? 'PEN';
        setCurrency(cur);

        // ── Build monthly summaries (convirtiendo a PEN) ───────────────────
        const txs = (txRes.data ?? []) as any[];
        const byMonth: Record<string, MonthSummary> = {};
        txs.forEach(tx => {
          const mes = (tx.fecha ?? tx.creado_en).slice(0, 7);
          if (!byMonth[mes]) byMonth[mes] = { mes, ingresos: 0, gastos: 0, porCat: {} };
          // Convertir a PEN: si moneda = USD se usa tipo_cambio guardado; si falta, 1
          const raw = Number(tx.monto);
          const amt = tx.moneda === 'USD' ? raw * (Number(tx.tipo_cambio) || 1) : raw;
          if (tx.tipo === 'ingreso') byMonth[mes].ingresos += amt;
          else {
            byMonth[mes].gastos += amt;
            byMonth[mes].porCat[tx.categoria] = (byMonth[mes].porCat[tx.categoria] ?? 0) + amt;
          }
        });
        const sorted = Object.values(byMonth).sort((a, b) => a.mes.localeCompare(b.mes));
        setSummaries(sorted);

        // ── Build product price history ────────────────────────────────────
        const dets = (detRes.data ?? []) as any[];
        const byProd: Record<string, { mes: string; precio: number }[]> = {};
        dets.forEach(d => {
          const tx = d.transacciones as any;
          if (!tx?.creado_en) return;
          const mes      = tx.creado_en.slice(0, 7);
          const key      = d.producto.toLowerCase().trim();
          const nombre   = d.producto;
          if (!byProd[nombre]) byProd[nombre] = [];
          byProd[nombre].push({ mes, precio: Number(d.precio_unitario) });
        });

        // Aggregate by product+month (avg per month)
        const prodList: ProductoPrecio[] = [];
        Object.entries(byProd).forEach(([nombre, entradas]) => {
          const porMes: Record<string, number[]> = {};
          entradas.forEach(e => {
            if (!porMes[e.mes]) porMes[e.mes] = [];
            porMes[e.mes].push(e.precio);
          });
          const historia = Object.entries(porMes)
            .sort(([a],[b]) => a.localeCompare(b))
            .map(([mes, precios]) => ({
              mes,
              precio: Math.round((precios.reduce((s,p)=>s+p,0) / precios.length) * 100) / 100,
            }));
          if (historia.length < 2) return;
          const precios   = historia.map(h => h.precio);
          const precioUlt = precios[precios.length - 1];
          const precioAvg = Math.round((precios.slice(0, -1).reduce((s,p)=>s+p,0) / (precios.length-1)) * 100) / 100;
          const pctChange = precioAvg > 0 ? Math.round(((precioUlt - precioAvg) / precioAvg) * 100) : 0;
          prodList.push({
            producto:  nombre,
            historia,
            precioUlt,
            precioAvg,
            pctChange,
            alerta:    precioUlt > precioAvg * 1.1,
          });
        });

        // Sort: alertas first, then by pctChange desc
        prodList.sort((a, b) => {
          if (a.alerta !== b.alerta) return a.alerta ? -1 : 1;
          return b.pctChange - a.pctChange;
        });
        setProductos(prodList);

        setLoading(false);
      })();
      return () => { active = false; };
    }, [])
  );

  const fetchDeuda = useCallback(async (mes: string) => {
    setLoadingDeuda(true);
    const { data, error } = await supabase.rpc('fn_deuda_capas', { p_mes: mes });
    if (!error && data) setDeudaCapas(data as DeudaCapa[]);
    setLoadingDeuda(false);
  }, []);

  const sym = SYM[currency] ?? currency;
  const fmt = (n: number) => `${sym} ${n.toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const fmtP = (n: number) => `${sym} ${n.toFixed(2)}`;

  function fmtMes(ym: string) {
    const [y, m] = ym.split('-');
    return `${MONTHS_ES[parseInt(m, 10) - 1]} ${y}`;
  }

  // ── Insights ──────────────────────────────────────────────────────────────
  function generateInsights(): string[] {
    const insights: string[] = [];
    if (summaries.length < 2) return insights;
    const last = summaries[summaries.length - 1];
    const prev = summaries[summaries.length - 2];

    const balLast = last.ingresos - last.gastos;
    const balPrev = prev.ingresos - prev.gastos;
    if (balLast > balPrev) {
      insights.push(`✅ Tu balance en ${fmtMes(last.mes)} (${fmt(balLast)}) mejoró respecto a ${fmtMes(prev.mes)} (${fmt(balPrev)}).`);
    } else if (balLast < balPrev) {
      insights.push(`⚠️ Tu balance bajó de ${fmt(balPrev)} en ${fmtMes(prev.mes)} a ${fmt(balLast)} en ${fmtMes(last.mes)}. Revisa tus gastos.`);
    }

    const gPct = pct(last.gastos, prev.gastos);
    if (Math.abs(gPct) >= 5) {
      const dir = gPct > 0 ? 'aumentaron' : 'bajaron';
      insights.push(`${gPct > 0 ? '📈' : '📉'} Tus gastos totales ${dir} un ${Math.abs(gPct)}% respecto al mes anterior.`);
    }

    const allCats = new Set([...Object.keys(last.porCat), ...Object.keys(prev.porCat)]);
    allCats.forEach(cat => {
      const a = last.porCat[cat] ?? 0;
      const b = prev.porCat[cat] ?? 0;
      if (b === 0 || a === 0) return;
      const diff = pct(a, b);
      if (diff >= 20) {
        insights.push(`📌 Gastaste un ${diff}% más en ${cat} que el mes pasado (${fmt(a)} vs ${fmt(b)}).`);
      } else if (diff <= -20) {
        insights.push(`🎉 Redujiste un ${Math.abs(diff)}% en ${cat}. ¡Buen trabajo!`);
      }
    });

    if (last.ingresos > 0) {
      const savRate = Math.round(((last.ingresos - last.gastos) / last.ingresos) * 100);
      if (savRate >= 20) insights.push(`💰 Tasa de ahorro: ${savRate}% en ${fmtMes(last.mes)}. ¡Dentro de la regla 50/30/20!`);
      else if (savRate > 0) insights.push(`💡 Tasa de ahorro: ${savRate}% en ${fmtMes(last.mes)}. La meta recomendada es 20%.`);
      else insights.push(`🚨 Tus gastos superaron tus ingresos en ${fmtMes(last.mes)}.`);
    }

    return insights.slice(0, 5);
  }

  const maxGastos   = Math.max(...summaries.map(s => s.gastos),   1);
  const maxIngresos = Math.max(...summaries.map(s => s.ingresos), 1);
  const insights    = generateInsights();

  const lastMonth = summaries[summaries.length - 1];
  const topCats   = lastMonth
    ? Object.entries(lastMonth.porCat).sort((a, b) => b[1] - a[1]).slice(0, 6)
    : [];

  const alertas   = productos.filter(p => p.alerta);

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
            {(['meses', 'categorias', 'precios', 'deuda'] as const).map(t => (
              <TouchableOpacity key={t} style={[s.tab, tab === t && s.tabOn]} onPress={() => {
                setTab(t);
                if (t === 'deuda' && deudaCapas.length === 0) fetchDeuda(mesDeuda);
              }}>
                <Text style={[s.tabText, tab === t && s.tabTextOn]}>
                  {t === 'meses' ? 'Meses' : t === 'categorias' ? 'Cats.' : t === 'precios' ? 'Precios' : 'Deuda'}
                </Text>
                {t === 'precios' && alertas.length > 0 && (
                  <View style={s.badge}><Text style={s.badgeText}>{alertas.length}</Text></View>
                )}
              </TouchableOpacity>
            ))}
          </View>

          {/* ── TAB: Por mes ── */}
          {tab === 'meses' && (
            <>
              <View style={s.card}>
                <Text style={s.cardTitle}>Comparativo mensual {new Date().getFullYear()}</Text>
                {summaries.map((sum, i) => {
                  const bal = sum.ingresos - sum.gastos;
                  const balColor = bal >= 0 ? '#22C55E' : '#DC2626';
                  const prevSum = summaries[i - 1];
                  const gastDiff = prevSum ? pct(sum.gastos, prevSum.gastos) : null;
                  return (
                    <View key={sum.mes} style={[s.monthRow, i < summaries.length - 1 && s.monthRowBorder]}>
                      <View style={{ width: 44 }}>
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

          {/* ── TAB: Por categoría ── */}
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

          {/* ── TAB: Precios e Inflación ── */}
          {tab === 'precios' && (
            <>
              {productos.length === 0 ? (
                <View style={s.card}>
                  <Text style={s.cardTitle}>📦 Precios e Inflación</Text>
                  <View style={{ paddingVertical: 20, alignItems: 'center' }}>
                    <Text style={{ fontSize: 36, marginBottom: 12 }}>🏷️</Text>
                    <Text style={s.emptyText}>
                      Importa tickets de supermercado para{'\n'}detectar variaciones de precios.
                    </Text>
                  </View>
                </View>
              ) : (
                <>
                  {/* Alertas de inflación */}
                  {alertas.length > 0 && (
                    <View style={[s.card, { borderLeftWidth: 4, borderLeftColor: '#EF4444' }]}>
                      <Text style={s.cardTitle}>🚨 Alerta de precios (+10% sobre promedio)</Text>
                      {alertas.map((p, i) => (
                        <View key={p.producto} style={[s.prodRow, i < alertas.length - 1 && s.prodRowBorder]}>
                          <View style={{ flex: 1 }}>
                            <Text style={s.prodName} numberOfLines={1}>{p.producto}</Text>
                            <Text style={s.prodMeta}>
                              Promedio: {fmtP(p.precioAvg)} · Actual: {fmtP(p.precioUlt)}
                            </Text>
                          </View>
                          <View style={{ alignItems: 'flex-end', gap: 4 }}>
                            <Text style={s.alertBadge}>▲ {p.pctChange}%</Text>
                            <Sparkline values={p.historia.map(h => h.precio)} alerta />
                          </View>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Todos los productos con historial */}
                  <View style={s.card}>
                    <Text style={s.cardTitle}>Evolución de precios por producto</Text>
                    <Text style={s.priceSubtitle}>
                      Precio unitario promedio mensual — última barra = más reciente
                    </Text>
                    {productos.map((p, i) => (
                      <View key={p.producto} style={[s.prodRow, i < productos.length - 1 && s.prodRowBorder]}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={s.prodName} numberOfLines={1}>{p.producto}</Text>
                          <Text style={s.prodMeta}>
                            {p.historia.map(h => `${fmtMes(h.mes).slice(0,3)}: ${fmtP(h.precio)}`).join('  ·  ')}
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end', gap: 4, marginLeft: 8 }}>
                          <Text style={[s.priceUlt, { color: p.alerta ? '#EF4444' : p.pctChange < 0 ? '#22C55E' : '#374151' }]}>
                            {fmtP(p.precioUlt)}
                          </Text>
                          {p.pctChange !== 0 && (
                            <Text style={[s.diffLabel, { color: p.pctChange > 0 ? '#EF4444' : '#22C55E' }]}>
                              {p.pctChange > 0 ? '▲' : '▼'} {Math.abs(p.pctChange)}%
                            </Text>
                          )}
                          <Sparkline values={p.historia.map(h => h.precio)} alerta={p.alerta} />
                        </View>
                      </View>
                    ))}
                  </View>

                  {/* Resumen inflación */}
                  <View style={[s.card, { backgroundColor: '#F0FDF4' }]}>
                    <Text style={s.cardTitle}>📊 Resumen</Text>
                    <View style={s.summaryRow}>
                      <View style={s.summaryItem}>
                        <Text style={s.summaryNum}>{productos.length}</Text>
                        <Text style={s.summaryLabel}>Productos rastreados</Text>
                      </View>
                      <View style={s.summarySep} />
                      <View style={s.summaryItem}>
                        <Text style={[s.summaryNum, { color: '#EF4444' }]}>{alertas.length}</Text>
                        <Text style={s.summaryLabel}>Con alza &gt;10%</Text>
                      </View>
                      <View style={s.summarySep} />
                      <View style={s.summaryItem}>
                        <Text style={[s.summaryNum, { color: '#22C55E' }]}>
                          {productos.filter(p => p.pctChange < 0).length}
                        </Text>
                        <Text style={s.summaryLabel}>Con baja de precio</Text>
                      </View>
                    </View>
                  </View>
                </>
              )}
            </>
          )}
          {/* ── TAB: Deuda (tres capas) ── */}
          {tab === 'deuda' && (
            <>
              {/* Selector de mes */}
              <View style={s.mesRow}>
                {[-1, 0].map(offset => {
                  const d = new Date();
                  d.setMonth(d.getMonth() + offset);
                  const val = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
                  const lbl = MONTHS_ES[d.getMonth()] + ' ' + d.getFullYear();
                  const active = mesDeuda === val;
                  return (
                    <TouchableOpacity
                      key={val}
                      style={[s.mesBtn, active && s.mesBtnOn]}
                      onPress={() => { setMesDeuda(val); fetchDeuda(val); }}
                    >
                      <Text style={[s.mesBtnText, active && s.mesBtnTextOn]}>{lbl}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {loadingDeuda ? (
                <ActivityIndicator color="#7C3AED" style={{ marginTop: 32 }} />
              ) : deudaCapas.length === 0 ? (
                <View style={s.card}>
                  <Text style={{ fontSize: 14, color: '#9CA3AF', textAlign: 'center', padding: 20 }}>
                    Sin datos de deuda para este mes.
                  </Text>
                </View>
              ) : (
                <>
                  {/* Leyenda */}
                  <View style={[s.card, { flexDirection: 'row', gap: 12, paddingVertical: 12 }]}>
                    {[
                      { color: '#3B82F6', label: 'Real' },
                      { color: '#F59E0B', label: 'Presupuestada' },
                      { color: '#EF4444', label: 'Proyectada' },
                    ].map(l => (
                      <View key={l.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                        <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: l.color }} />
                        <Text style={{ fontSize: 11, color: '#6B7280' }}>{l.label}</Text>
                      </View>
                    ))}
                    <Text style={{ fontSize: 10, color: '#9CA3AF', flex: 1, textAlign: 'right' }}>
                      Montos en PEN
                    </Text>
                  </View>

                  {/* Tarjeta por categoría */}
                  {deudaCapas.map((row, i) => {
                    const maxVal = Math.max(row.deuda_real, row.deuda_presupuestada, row.deuda_proyectada, 1);
                    return (
                      <View key={row.categoria} style={s.card}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                          <Text style={{ fontSize: 18, marginRight: 8 }}>
                            {ICON_MAP[row.categoria] ?? '📦'}
                          </Text>
                          <Text style={s.cardTitle}>{row.categoria}</Text>
                        </View>

                        {/* Barra Real */}
                        <View style={s.deudaRow}>
                          <Text style={s.deudaLabel}>Real</Text>
                          <View style={s.deudaBarBg}>
                            <View style={[s.deudaBarFill, {
                              width: `${Math.round((row.deuda_real / maxVal) * 100)}%` as any,
                              backgroundColor: '#3B82F6',
                            }]} />
                          </View>
                          <Text style={[s.deudaAmt, { color: '#3B82F6' }]}>{fmt(row.deuda_real)}</Text>
                        </View>

                        {/* Barra Presupuestada */}
                        <View style={s.deudaRow}>
                          <Text style={s.deudaLabel}>Presup.</Text>
                          <View style={s.deudaBarBg}>
                            <View style={[s.deudaBarFill, {
                              width: `${Math.round((row.deuda_presupuestada / maxVal) * 100)}%` as any,
                              backgroundColor: '#F59E0B',
                            }]} />
                          </View>
                          <Text style={[s.deudaAmt, { color: '#F59E0B' }]}>{fmt(row.deuda_presupuestada)}</Text>
                        </View>

                        {/* Barra Proyectada */}
                        <View style={s.deudaRow}>
                          <Text style={s.deudaLabel}>Proyect.</Text>
                          <View style={s.deudaBarBg}>
                            <View style={[s.deudaBarFill, {
                              width: `${Math.round((row.deuda_proyectada / maxVal) * 100)}%` as any,
                              backgroundColor: '#EF4444',
                            }]} />
                          </View>
                          <Text style={[s.deudaAmt, { color: '#EF4444' }]}>{fmt(row.deuda_proyectada)}</Text>
                        </View>

                        {/* Delta proyectado vs real */}
                        {row.deuda_proyectada > row.deuda_real && (
                          <Text style={{ fontSize: 11, color: '#EF4444', marginTop: 6 }}>
                            ▲ {fmt(row.deuda_proyectada - row.deuda_real)} por encima de lo ya registrado al cierre del mes
                          </Text>
                        )}
                      </View>
                    );
                  })}

                  {/* Totales */}
                  <View style={[s.card, { backgroundColor: '#F8F9FB' }]}>
                    <Text style={s.cardTitle}>Totales del mes</Text>
                    {[
                      { label: 'Deuda Real',         val: deudaCapas.reduce((s,r)=>s+r.deuda_real,0),          color: '#3B82F6' },
                      { label: 'Deuda Presupuestada', val: deudaCapas.reduce((s,r)=>s+r.deuda_presupuestada,0), color: '#F59E0B' },
                      { label: 'Deuda Proyectada',    val: deudaCapas.reduce((s,r)=>s+r.deuda_proyectada,0),    color: '#EF4444' },
                    ].map(t => (
                      <View key={t.label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
                        <Text style={{ fontSize: 13, color: '#374151' }}>{t.label}</Text>
                        <Text style={{ fontSize: 14, fontWeight: '700', color: t.color }}>{fmt(t.val)}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}
            </>
          )}

        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: Platform.OS === 'android' ? 44 : 12,
            paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  title:  { fontSize: 20, fontWeight: '800', color: '#111827' },

  empty:     { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyText: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 22 },

  tabs:       { flexDirection: 'row', backgroundColor: '#F3F4F6', borderRadius: 12, padding: 4, marginBottom: 16 },
  tab:        { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 10, flexDirection: 'row', justifyContent: 'center', gap: 4 },
  tabOn:      { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  tabText:    { fontSize: 12, fontWeight: '500', color: '#9CA3AF' },
  tabTextOn:  { color: '#111827', fontWeight: '700' },
  badge:      { backgroundColor: '#EF4444', borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },
  badgeText:  { color: '#fff', fontSize: 9, fontWeight: '800' },

  card:      { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 14,
               shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#111827', marginBottom: 14 },

  monthRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  monthRowBorder: { borderBottomWidth: 1, borderBottomColor: '#F9FAFB' },
  monthLabel:     { fontSize: 11, fontWeight: '600', color: '#6B7280' },
  barLabelIn:     { fontSize: 12, color: '#22C55E', fontWeight: '700', width: 14 },
  barLabelOut:    { fontSize: 12, color: '#EF4444', fontWeight: '700', width: 14 },
  barAmt:         { fontSize: 10, color: '#9CA3AF', width: 68, textAlign: 'right' },
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

  // Precios
  prodRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  prodRowBorder: { borderBottomWidth: 1, borderBottomColor: '#F9FAFB' },
  prodName:      { fontSize: 14, fontWeight: '600', color: '#111827', marginBottom: 3 },
  prodMeta:      { fontSize: 10, color: '#9CA3AF', lineHeight: 14 },
  priceUlt:      { fontSize: 14, fontWeight: '700', color: '#374151' },
  alertBadge:    { backgroundColor: '#FEF2F2', color: '#DC2626', fontSize: 12,
                   fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  priceSubtitle: { fontSize: 11, color: '#9CA3AF', marginBottom: 12, marginTop: -8 },

  summaryRow:  { flexDirection: 'row', paddingTop: 4 },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryNum:  { fontSize: 22, fontWeight: '800', color: '#111827' },
  summaryLabel:{ fontSize: 11, color: '#6B7280', textAlign: 'center', marginTop: 2 },
  summarySep:  { width: 1, backgroundColor: '#E5E7EB', marginHorizontal: 8 },

  // Deuda (tres capas)
  mesRow:       { flexDirection: 'row', gap: 8, marginBottom: 12 },
  mesBtn:       { flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: '#F3F4F6', alignItems: 'center' },
  mesBtnOn:     { backgroundColor: '#7C3AED' },
  mesBtnText:   { fontSize: 12, fontWeight: '600', color: '#6B7280' },
  mesBtnTextOn: { color: '#fff' },
  deudaRow:    { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 8 },
  deudaLabel:  { fontSize: 11, color: '#6B7280', width: 52 },
  deudaBarBg:  { flex: 1, height: 8, backgroundColor: '#F3F4F6', borderRadius: 4, overflow: 'hidden' },
  deudaBarFill:{ height: '100%', borderRadius: 4 },
  deudaAmt:    { fontSize: 11, fontWeight: '700', width: 64, textAlign: 'right' },
});
