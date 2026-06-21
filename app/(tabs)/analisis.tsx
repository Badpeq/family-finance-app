import { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  Platform, SafeAreaView, TouchableOpacity, Animated, StatusBar,
  useWindowDimensions,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useExchangeRate } from '@/hooks/useExchangeRate';
import SparklineChart from '@/components/SparklineChart';

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  screen:      '#F7F8FA',
  hero:        '#080C10',
  card:        '#FFFFFF',
  border:      'rgba(0,0,0,0.06)',
  textPrimary: '#0D1117',
  textSec:     '#6B7280',
  textMicro:   '#9CA3AF',
  textHero:    '#FFFFFF',
  textMuted:   'rgba(255,255,255,0.50)',
  textLabel:   'rgba(255,255,255,0.30)',
  accent:      '#3B82F6',
  green:       '#00D084',
  amber:       '#F59E0B',
  red:         '#FF3B30',
};

const SYM: Record<string, string> = {
  PEN: 'S/', USD: '$', EUR: '€', BRL: 'R$', COP: '$', MXN: '$', ARS: '$', CLP: '$',
};

const CAT_ICONS: Record<string, string> = {
  Alimentación: '🛒', Transporte: '🚗', Vivienda: '🏠', Entretenimiento: '🎬',
  Salud: '💊', Educación: '📚', Ropa: '👕', Servicios: '⚡', Restaurantes: '🍽️',
  Otros: '📦', Sueldo: '💼', Bono: '🎁', Freelance: '💻', Inversiones: '📈', Negocio: '🏪',
};

const MONTHS_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

// ── Types ─────────────────────────────────────────────────────────────────────
interface MonthSummary {
  mes:      string;
  ingresos: number;
  gastos:   number;
  porCat:   Record<string, number>;
}

interface Subcat {
  id:     string | null;
  nombre: string;
  total:  number;
}

interface ProductoPrecio {
  producto:  string;
  historia:  { mes: string; precio: number }[];
  precioUlt: number;
  precioAvg: number;
  pctChange: number;
  alerta:    boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtMes(ym: string) {
  const [y, m] = ym.split('-');
  return `${MONTHS_ES[parseInt(m, 10) - 1]} ${y.slice(2)}`;
}

function pctDelta(a: number, b: number) {
  if (b === 0) return 0;
  return Math.round(((a - b) / b) * 100);
}

function getLast7Months(): string[] {
  const now = new Date();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (6 - i), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function Analisis() {
  const { width: screenW } = useWindowDimensions();

  const now        = new Date();
  const currentMes = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const allMonths  = getLast7Months();

  const [tab,       setTab]       = useState<'resumen' | 'categorias' | 'precios'>('resumen');
  const [mesSel,    setMesSel]    = useState(currentMes);
  const [catSel,    setCatSel]    = useState<string | null>(null);
  const [currency,  setCurrency]  = useState('PEN');
  const [summaries, setSummaries] = useState<MonthSummary[]>([]);
  const [subcats,   setSubcats]   = useState<Subcat[]>([]);
  const [productos, setProductos] = useState<ProductoPrecio[]>([]);
  const [selProd,   setSelProd]   = useState<string | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [subcatsLoading, setSubcatsLoading] = useState(false);

  const { rate }  = useExchangeRate();
  const fadeAnim  = useRef(new Animated.Value(1)).current;

  // Responsive chart widths
  const heroSparkW  = screenW - 32 - 44;   // hero card width minus label/padding
  const bentoSparkW = (screenW - 48) / 2 - 28;
  const expandW     = screenW - 64;

  // ── Main data fetch ──────────────────────────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !active) return;

        const since = allMonths[0] + '-01T00:00:00';

        const [profRes, txRes, detRes] = await Promise.all([
          supabase.from('profiles').select('moneda_base').eq('id', user.id).single(),
          supabase
            .from('transacciones')
            .select('tipo,monto,categoria,creado_en,fecha,moneda,tipo_cambio')
            .eq('user_id', user.id)
            .eq('activo', true)
            .gte('creado_en', since)
            .order('creado_en', { ascending: true }),
          supabase
            .from('transaccion_detalles')
            .select('producto,precio_unitario,transacciones!inner(creado_en,user_id)')
            .eq('transacciones.user_id', user.id),
        ]);

        if (!active) return;
        const cur = (profRes.data as any)?.moneda_base ?? 'PEN';
        setCurrency(cur);

        // Build monthly summaries with USD→PEN conversion
        const txs = (txRes.data ?? []) as any[];
        const byMonth: Record<string, MonthSummary> = {};
        txs.forEach(tx => {
          const dateStr = tx.fecha ?? tx.creado_en.slice(0, 10);
          const mes     = dateStr.slice(0, 7);
          if (!byMonth[mes]) byMonth[mes] = { mes, ingresos: 0, gastos: 0, porCat: {} };

          const mon = tx.moneda ?? 'PEN';
          const amt = mon === 'USD'
            ? Number(tx.monto) * (Number(tx.tipo_cambio) || rate.venta)
            : Number(tx.monto);

          if (tx.tipo === 'ingreso') {
            byMonth[mes].ingresos += amt;
          } else {
            byMonth[mes].gastos += amt;
            byMonth[mes].porCat[tx.categoria] = (byMonth[mes].porCat[tx.categoria] ?? 0) + amt;
          }
        });

        setSummaries(
          allMonths.map(m => byMonth[m] ?? { mes: m, ingresos: 0, gastos: 0, porCat: {} })
        );

        // Build product price history
        const dets = (detRes.data ?? []) as any[];
        const byProd: Record<string, { mes: string; precio: number }[]> = {};
        dets.forEach(d => {
          const tx = d.transacciones as any;
          if (!tx?.creado_en) return;
          const mes = tx.creado_en.slice(0, 7);
          if (!byProd[d.producto]) byProd[d.producto] = [];
          byProd[d.producto].push({ mes, precio: Number(d.precio_unitario) });
        });

        const prodList: ProductoPrecio[] = [];
        Object.entries(byProd).forEach(([nombre, entradas]) => {
          const porMes: Record<string, number[]> = {};
          entradas.forEach(e => {
            if (!porMes[e.mes]) porMes[e.mes] = [];
            porMes[e.mes].push(e.precio);
          });
          const historia = Object.entries(porMes)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([mes, precios]) => ({
              mes,
              precio: Math.round((precios.reduce((s, p) => s + p, 0) / precios.length) * 100) / 100,
            }));
          if (historia.length < 1) return;
          const precios    = historia.map(h => h.precio);
          const precioUlt  = precios[precios.length - 1];
          const precioAvg  = precios.length > 1
            ? Math.round((precios.slice(0, -1).reduce((s, p) => s + p, 0) / (precios.length - 1)) * 100) / 100
            : precioUlt;
          const pctChange  = precioAvg > 0 ? Math.round(((precioUlt - precioAvg) / precioAvg) * 100) : 0;
          prodList.push({ producto: nombre, historia, precioUlt, precioAvg, pctChange, alerta: pctChange > 5 });
        });
        prodList.sort((a, b) => { if (a.alerta !== b.alerta) return a.alerta ? -1 : 1; return b.pctChange - a.pctChange; });
        setProductos(prodList);
        setLoading(false);
      })();
      return () => { active = false; };
    }, [])
  );

  // ── Subcategory fetch when catSel or mesSel changes ──────────────────────────
  useEffect(() => {
    if (!catSel) { setSubcats([]); return; }
    let active = true;
    setSubcatsLoading(true);
    setSubcats([]);
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !active) return;

      const [y, m] = mesSel.split('-').map(Number);
      const start  = `${mesSel}-01`;
      const endD   = new Date(y, m, 1);
      const end    = `${endD.getFullYear()}-${String(endD.getMonth() + 1).padStart(2, '0')}-01`;

      const [scRes, txRes] = await Promise.all([
        supabase.from('subcategorias').select('id,nombre').eq('categoria_nombre', catSel),
        supabase
          .from('transacciones')
          .select('subcategoria_id,monto,moneda,tipo_cambio')
          .eq('user_id', user.id)
          .eq('tipo', 'gasto')
          .eq('categoria', catSel)
          .eq('activo', true)
          .or(
            `and(fecha.gte.${start},fecha.lt.${end}),` +
            `and(fecha.is.null,creado_en.gte.${start}T00:00:00,creado_en.lt.${end}T00:00:00)`
          ),
      ]);

      if (!active) return;
      const names: Record<string, string> = {};
      (scRes.data ?? []).forEach((sc: any) => { names[sc.id] = sc.nombre; });

      const bySubcat: Record<string, number> = {};
      (txRes.data ?? []).forEach((tx: any) => {
        const mon = tx.moneda ?? 'PEN';
        const amt = mon === 'USD' ? Number(tx.monto) * (Number(tx.tipo_cambio) || rate.venta) : Number(tx.monto);
        const key = tx.subcategoria_id ?? '__none__';
        bySubcat[key] = (bySubcat[key] ?? 0) + amt;
      });

      const result: Subcat[] = Object.entries(bySubcat)
        .filter(([, v]) => v > 0)
        .map(([id, total]) => ({
          id:     id === '__none__' ? null : id,
          nombre: id === '__none__' ? 'Sin subcategoría' : (names[id] ?? 'Desconocida'),
          total,
        }))
        .sort((a, b) => b.total - a.total);

      setSubcats(result);
      setSubcatsLoading(false);
    })();
    return () => { active = false; };
  }, [catSel, mesSel]);

  // ── Derived values ────────────────────────────────────────────────────────────
  const sym  = SYM[currency] ?? currency;
  const fmt  = (n: number) => `${sym} ${Math.round(n).toLocaleString('es-PE')}`;
  const fmtP = (n: number) => `${sym} ${n.toFixed(2)}`;

  const selSum  = summaries.find(s => s.mes === mesSel) ?? { mes: mesSel, ingresos: 0, gastos: 0, porCat: {} };
  const prevIdx = summaries.findIndex(s => s.mes === mesSel) - 1;
  const prevSum = prevIdx >= 0 ? summaries[prevIdx] : null;

  const catsForMes = Object.entries(selSum.porCat).sort(([, a], [, b]) => b - a);
  const catTotal   = catSel ? (selSum.porCat[catSel] ?? 0) : selSum.gastos;
  const catPrev    = catSel ? (prevSum?.porCat[catSel] ?? 0) : (prevSum?.gastos ?? 0);
  const catDelta   = pctDelta(catTotal, catPrev);
  const catSpark   = summaries.map(s => catSel ? (s.porCat[catSel] ?? 0) : s.gastos);
  const subcatsTotal = subcats.reduce((acc, sc) => acc + sc.total, 0);
  const alertas    = productos.filter(p => p.alerta);
  const maxBar     = Math.max(...summaries.map(s => Math.max(s.ingresos, s.gastos)), 1);
  const hasData    = summaries.some(s => s.gastos > 0 || s.ingresos > 0);

  // ── Tab switch with fade ──────────────────────────────────────────────────────
  const switchTab = (t: typeof tab) => {
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 0, duration: 80,  useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
    setTab(t);
    setCatSel(null);
    setSelProd(null);
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <View style={s.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.screen} />

      <SafeAreaView style={{ backgroundColor: C.screen }}>
        <View style={s.topBar}>
          <Text style={s.topTitle}>Análisis</Text>
          <View style={s.segmented}>
            {(['resumen', 'categorias', 'precios'] as const).map(t => (
              <TouchableOpacity
                key={t}
                style={[s.segBtn, tab === t && s.segBtnOn]}
                onPress={() => switchTab(t)}
                activeOpacity={0.7}
              >
                <Text style={[s.segText, tab === t && s.segTextOn]}>
                  {t === 'resumen' ? 'Resumen' : t === 'categorias' ? 'Categorías' : 'Precios'}
                </Text>
                {t === 'precios' && alertas.length > 0 && <View style={s.alertDot} />}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </SafeAreaView>

      {loading ? (
        <ActivityIndicator color={C.accent} style={{ marginTop: 60 }} />
      ) : !hasData ? (
        <View style={s.emptyState}>
          <Text style={{ fontSize: 40, marginBottom: 12 }}>📊</Text>
          <Text style={s.emptyText}>Sin datos.{'\n'}Registra transacciones primero.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          <Animated.View style={{ opacity: fadeAnim }}>

            {/* ── Month pills (Resumen + Categorías) ── */}
            {tab !== 'precios' && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.pillRow}
              >
                {summaries.map(sum => (
                  <TouchableOpacity
                    key={sum.mes}
                    style={[s.pill, sum.mes === mesSel && s.pillOn]}
                    onPress={() => setMesSel(sum.mes)}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.pillText, sum.mes === mesSel && s.pillTextOn]}>
                      {fmtMes(sum.mes)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {/* ════════ TAB: RESUMEN ════════ */}
            {tab === 'resumen' && (() => {
              const bal     = selSum.ingresos - selSum.gastos;
              const savRate = selSum.ingresos > 0
                ? Math.round(((selSum.ingresos - selSum.gastos) / selSum.ingresos) * 100)
                : 0;
              return (
                <>
                  {/* Balance hero */}
                  <View style={s.heroCard}>
                    <Text style={s.heroLabel}>BALANCE — {fmtMes(mesSel).toUpperCase()}</Text>
                    <Text style={[s.heroAmt, { color: bal >= 0 ? C.green : C.red }]}>
                      {bal >= 0 ? '+' : ''}{fmt(bal)}
                    </Text>
                    <View style={s.heroDivider} />
                    <View style={s.heroRow}>
                      <View style={s.heroCol}>
                        <Text style={s.heroColLabel}>INGRESOS</Text>
                        <Text style={[s.heroColAmt, { color: C.green }]}>{fmt(selSum.ingresos)}</Text>
                      </View>
                      <View style={s.heroColDiv} />
                      <View style={s.heroCol}>
                        <Text style={s.heroColLabel}>GASTOS</Text>
                        <Text style={[s.heroColAmt, { color: C.red }]}>{fmt(selSum.gastos)}</Text>
                      </View>
                      {selSum.ingresos > 0 && (
                        <>
                          <View style={s.heroColDiv} />
                          <View style={s.heroCol}>
                            <Text style={s.heroColLabel}>AHORRO</Text>
                            <Text style={[s.heroColAmt, { color: savRate >= 0 ? C.green : C.red }]}>
                              {savRate}%
                            </Text>
                          </View>
                        </>
                      )}
                    </View>
                  </View>

                  {/* Sparkline bento row */}
                  <View style={s.bentoRow}>
                    <View style={[s.bentoCard, { flex: 1 }]}>
                      <Text style={s.bentoLabel}>GASTOS — TENDENCIA</Text>
                      <SparklineChart
                        values={summaries.map(sm => sm.gastos)}
                        color={C.red}
                        width={bentoSparkW}
                        height={40}
                      />
                      <Text style={s.bentoSub}>7 meses</Text>
                    </View>
                    <View style={[s.bentoCard, { flex: 1, marginLeft: 8 }]}>
                      <Text style={s.bentoLabel}>INGRESOS — TENDENCIA</Text>
                      <SparklineChart
                        values={summaries.map(sm => sm.ingresos)}
                        color={C.green}
                        width={bentoSparkW}
                        height={40}
                      />
                      <Text style={s.bentoSub}>7 meses</Text>
                    </View>
                  </View>

                  {/* Monthly comparison */}
                  <View style={s.card}>
                    <Text style={s.cardTitle}>Comparativo mensual</Text>
                    {summaries.map((sum, i) => {
                      const bal2     = sum.ingresos - sum.gastos;
                      const bColor   = bal2 >= 0 ? C.green : C.red;
                      const isSel    = sum.mes === mesSel;
                      return (
                        <TouchableOpacity
                          key={sum.mes}
                          style={[s.monthRow, i < summaries.length - 1 && s.rowBorder, isSel && s.monthRowSel]}
                          onPress={() => setMesSel(sum.mes)}
                          activeOpacity={0.7}
                        >
                          <Text style={[s.monthLabel, isSel && { color: C.accent, fontWeight: '700' }]}>
                            {fmtMes(sum.mes)}
                          </Text>
                          <View style={s.barsCol}>
                            <View style={s.barRow}>
                              <View style={s.barBg}>
                                <View style={[s.barFill, {
                                  width: `${Math.min((sum.ingresos / maxBar) * 100, 100)}%` as any,
                                  backgroundColor: C.green + '88',
                                }]} />
                              </View>
                              <Text style={s.barAmt}>{fmt(sum.ingresos)}</Text>
                            </View>
                            <View style={[s.barRow, { marginTop: 3 }]}>
                              <View style={s.barBg}>
                                <View style={[s.barFill, {
                                  width: `${Math.min((sum.gastos / maxBar) * 100, 100)}%` as any,
                                  backgroundColor: C.red + '88',
                                }]} />
                              </View>
                              <Text style={s.barAmt}>{fmt(sum.gastos)}</Text>
                            </View>
                          </View>
                          <Text style={[s.balBadge, { color: bColor }]}>
                            {bal2 >= 0 ? '+' : ''}{fmt(bal2)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              );
            })()}

            {/* ════════ TAB: CATEGORÍAS ════════ */}
            {tab === 'categorias' && (
              <>
                {/* Category pills */}
                {catsForMes.length > 0 && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={[s.pillRow, { paddingTop: 0 }]}
                  >
                    <TouchableOpacity
                      style={[s.pill, !catSel && s.pillOn]}
                      onPress={() => setCatSel(null)}
                      activeOpacity={0.7}
                    >
                      <Text style={[s.pillText, !catSel && s.pillTextOn]}>Total</Text>
                    </TouchableOpacity>
                    {catsForMes.map(([cat]) => (
                      <TouchableOpacity
                        key={cat}
                        style={[s.pill, catSel === cat && s.pillOn]}
                        onPress={() => setCatSel(cat)}
                        activeOpacity={0.7}
                      >
                        <Text style={[s.pillText, catSel === cat && s.pillTextOn]}>
                          {CAT_ICONS[cat] ?? '📦'} {cat}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}

                {/* Hero card */}
                <View style={s.heroCard}>
                  <Text style={s.heroLabel}>
                    {catSel
                      ? `${CAT_ICONS[catSel] ?? '📦'} ${catSel.toUpperCase()} — ${fmtMes(mesSel).toUpperCase()}`
                      : `TOTAL GASTOS — ${fmtMes(mesSel).toUpperCase()}`
                    }
                  </Text>
                  <View style={s.heroAmtRow}>
                    <Text style={s.heroAmt}>{fmt(catTotal)}</Text>
                    {catPrev > 0 && (
                      <View style={[s.deltaBadge, {
                        backgroundColor: catDelta > 0 ? C.red + '22' : C.green + '22',
                      }]}>
                        <Text style={[s.deltaBadgeText, { color: catDelta > 0 ? C.red : C.green }]}>
                          {catDelta > 0 ? '▲' : '▼'} {Math.abs(catDelta)}%
                        </Text>
                      </View>
                    )}
                  </View>
                  <View style={s.heroSparkRow}>
                    <SparklineChart
                      values={catSpark}
                      color={catDelta > 5 ? C.red : catDelta < -5 ? C.green : C.accent}
                      width={heroSparkW}
                      height={48}
                      strokeWidth={2}
                    />
                  </View>
                  {catPrev > 0 && (
                    <Text style={s.heroMeta}>
                      Mes anterior: {fmt(catPrev)} · {catDelta > 0 ? 'Subió' : 'Bajó'} {Math.abs(catDelta)}%
                    </Text>
                  )}
                </View>

                {/* Subcategories card — only when a category is selected */}
                {catSel && (
                  <View style={s.card}>
                    <Text style={s.cardTitle}>Subcategorías</Text>
                    {subcatsLoading ? (
                      <ActivityIndicator color={C.accent} style={{ marginVertical: 16 }} />
                    ) : subcats.length === 0 ? (
                      <Text style={s.emptyMini}>Sin subcategorías registradas este mes.</Text>
                    ) : (
                      subcats.map((sc, i) => {
                        const share = subcatsTotal > 0 ? (sc.total / subcatsTotal) * 100 : 0;
                        return (
                          <View key={sc.id ?? 'none'} style={[s.subcatRow, i < subcats.length - 1 && s.rowBorder]}>
                            <View style={s.subcatTitleRow}>
                              <Text style={s.subcatName}>{sc.nombre}</Text>
                              <Text style={s.subcatAmt}>{fmt(sc.total)}</Text>
                            </View>
                            <View style={s.microBarBg}>
                              <View style={[s.microBarFill, {
                                width: `${share}%` as any,
                                backgroundColor: C.accent,
                              }]} />
                            </View>
                            <Text style={s.subcatShare}>{Math.round(share)}% del total</Text>
                          </View>
                        );
                      })
                    )}
                  </View>
                )}

                {/* Distribution list */}
                {catsForMes.length > 0 && (
                  <View style={s.card}>
                    <Text style={s.cardTitle}>Distribución — {fmtMes(mesSel)}</Text>
                    {catsForMes.map(([cat, amt], i) => {
                      const share    = selSum.gastos > 0 ? (amt / selSum.gastos) * 100 : 0;
                      const prevAmt  = prevSum?.porCat[cat] ?? 0;
                      const delta    = pctDelta(amt, prevAmt);
                      const isFocus  = catSel === cat;
                      return (
                        <TouchableOpacity
                          key={cat}
                          style={[s.distRow, i < catsForMes.length - 1 && s.rowBorder]}
                          onPress={() => setCatSel(isFocus ? null : cat)}
                          activeOpacity={0.7}
                        >
                          <Text style={s.distIcon}>{CAT_ICONS[cat] ?? '📦'}</Text>
                          <View style={s.distBody}>
                            <View style={s.distTitleRow}>
                              <Text style={[s.distCat, isFocus && { color: C.accent }]}>{cat}</Text>
                              <View style={s.distRight}>
                                {prevAmt > 0 && (
                                  <Text style={[s.distDelta, { color: delta > 0 ? C.red : C.green }]}>
                                    {delta > 0 ? '▲' : '▼'}{Math.abs(delta)}%
                                  </Text>
                                )}
                                <Text style={s.distAmt}>{fmt(amt)}</Text>
                              </View>
                            </View>
                            <View style={s.microBarBg}>
                              <View style={[s.microBarFill, {
                                width: `${share}%` as any,
                                backgroundColor: isFocus ? C.accent : C.textMicro + '55',
                              }]} />
                            </View>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </>
            )}

            {/* ════════ TAB: PRECIOS ════════ */}
            {tab === 'precios' && (
              <>
                {/* Alert banner */}
                {alertas.length > 0 && (
                  <View style={s.alertBanner}>
                    <Text style={s.alertBannerIcon}>⚠</Text>
                    <Text style={s.alertBannerText}>
                      {alertas.length} producto{alertas.length > 1 ? 's' : ''} con alza {'>'} 5% sobre el promedio
                    </Text>
                  </View>
                )}

                {/* Stats bento */}
                <View style={s.bentoRow}>
                  <View style={[s.bentoCard, { flex: 1 }]}>
                    <Text style={s.bentoLabel}>RASTREADOS</Text>
                    <Text style={s.bentoStatNum}>{productos.length}</Text>
                  </View>
                  <View style={[s.bentoCard, { flex: 1, marginLeft: 8 }]}>
                    <Text style={s.bentoLabel}>CON ALZA</Text>
                    <Text style={[s.bentoStatNum, { color: alertas.length > 0 ? C.red : C.textPrimary }]}>
                      {alertas.length}
                    </Text>
                  </View>
                  <View style={[s.bentoCard, { flex: 1, marginLeft: 8 }]}>
                    <Text style={s.bentoLabel}>A LA BAJA</Text>
                    <Text style={[s.bentoStatNum, { color: C.green }]}>
                      {productos.filter(p => p.pctChange < 0).length}
                    </Text>
                  </View>
                </View>

                {/* Product list */}
                {productos.length === 0 ? (
                  <View style={[s.card, { alignItems: 'center', paddingVertical: 32 }]}>
                    <Text style={{ fontSize: 36, marginBottom: 12 }}>🏷️</Text>
                    <Text style={s.emptyText}>
                      Registra compras con detalles de productos para rastrear precios.
                    </Text>
                  </View>
                ) : (
                  <View style={s.card}>
                    <Text style={s.cardTitle}>Evolución de precios</Text>
                    {productos.map((prod, i) => {
                      const isExp    = selProd === prod.producto;
                      const lineClr  = prod.alerta ? C.red : prod.pctChange < 0 ? C.green : C.accent;
                      return (
                        <View key={prod.producto}>
                          <TouchableOpacity
                            style={[s.prodRow, !isExp && i < productos.length - 1 && s.rowBorder]}
                            onPress={() => setSelProd(isExp ? null : prod.producto)}
                            activeOpacity={0.7}
                          >
                            <View style={s.prodLeft}>
                              <View style={s.prodNameRow}>
                                <Text style={s.prodName} numberOfLines={1}>{prod.producto}</Text>
                                {prod.alerta && (
                                  <View style={s.alertPill}>
                                    <Text style={s.alertPillText}>▲ {prod.pctChange}%</Text>
                                  </View>
                                )}
                                {!prod.alerta && prod.pctChange < 0 && (
                                  <View style={[s.alertPill, { backgroundColor: C.green + '22' }]}>
                                    <Text style={[s.alertPillText, { color: C.green }]}>
                                      ▼ {Math.abs(prod.pctChange)}%
                                    </Text>
                                  </View>
                                )}
                              </View>
                              <Text style={s.prodMeta}>
                                Actual: {fmtP(prod.precioUlt)}
                                {prod.historia.length > 1 ? ` · Prom: ${fmtP(prod.precioAvg)}` : ''}
                              </Text>
                            </View>
                            <View style={s.prodRight}>
                              <SparklineChart
                                values={prod.historia.map(h => h.precio)}
                                color={lineClr}
                                width={60}
                                height={28}
                                strokeWidth={1.5}
                              />
                              <Text style={s.expandHint}>{isExp ? '▲' : '▼'}</Text>
                            </View>
                          </TouchableOpacity>

                          {/* Expanded view */}
                          {isExp && (
                            <View style={[s.expandedBox, i < productos.length - 1 && s.rowBorder]}>
                              <SparklineChart
                                values={prod.historia.map(h => h.precio)}
                                color={lineClr}
                                width={expandW}
                                height={64}
                                strokeWidth={2}
                              />
                              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                <View style={s.historyRow}>
                                  {prod.historia.map(h => (
                                    <View key={h.mes} style={s.historyCell}>
                                      <Text style={s.historyMes}>{fmtMes(h.mes)}</Text>
                                      <Text style={s.historyPrice}>{fmtP(h.precio)}</Text>
                                    </View>
                                  ))}
                                </View>
                              </ScrollView>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}
              </>
            )}

          </Animated.View>
        </ScrollView>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.screen },
  scroll: { padding: 16, paddingBottom: 120 },

  // Top bar
  topBar: {
    paddingHorizontal: 20,
    paddingTop:   Platform.OS === 'android' ? 44 : 14,
    paddingBottom: 12,
  },
  topTitle:  { fontSize: 22, fontWeight: '800', color: C.textPrimary, letterSpacing: -0.3, marginBottom: 12 },

  // Segmented control
  segmented: { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.06)', borderRadius: 12, padding: 3 },
  segBtn:    { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 10, flexDirection: 'row', justifyContent: 'center', gap: 4 },
  segBtnOn:  { backgroundColor: C.card, shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 4, elevation: 2 },
  segText:   { fontSize: 12, fontWeight: '500', color: C.textSec },
  segTextOn: { color: C.textPrimary, fontWeight: '700' },
  alertDot:  { width: 6, height: 6, borderRadius: 3, backgroundColor: C.red },

  // Pills
  pillRow:    { flexDirection: 'row', paddingHorizontal: 0, paddingBottom: 12, paddingTop: 4, gap: 6 },
  pill:       { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  pillOn:     { backgroundColor: C.textPrimary, borderColor: C.textPrimary },
  pillText:   { fontSize: 12, fontWeight: '500', color: C.textSec },
  pillTextOn: { color: '#fff', fontWeight: '600' },

  // Hero card
  heroCard:    { backgroundColor: C.hero, borderRadius: 22, padding: 22, marginBottom: 10 },
  heroLabel:   { fontSize: 9, fontWeight: '600', color: C.textLabel, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 },
  heroAmt:     { fontSize: 40, fontWeight: '800', color: C.textHero, letterSpacing: -1.5 },
  heroAmtRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  heroSparkRow:{ marginTop: 14 },
  heroMeta:    { fontSize: 11, color: C.textMuted, marginTop: 10 },
  heroDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginVertical: 14 },
  heroRow:     { flexDirection: 'row' },
  heroCol:     { flex: 1 },
  heroColDiv:  { width: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginHorizontal: 10 },
  heroColLabel:{ fontSize: 9, fontWeight: '600', color: C.textLabel, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 4 },
  heroColAmt:  { fontSize: 16, fontWeight: '700', color: C.textHero },

  deltaBadge:     { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  deltaBadgeText: { fontSize: 12, fontWeight: '700' },

  // Bento row
  bentoRow:    { flexDirection: 'row', marginBottom: 10 },
  bentoCard:   { backgroundColor: C.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.border },
  bentoLabel:  { fontSize: 9, fontWeight: '600', color: C.textMicro, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8 },
  bentoSub:    { fontSize: 10, color: C.textMicro, marginTop: 4 },
  bentoStatNum:{ fontSize: 26, fontWeight: '800', color: C.textPrimary, letterSpacing: -0.5, marginTop: 4 },

  // Card
  card:      { backgroundColor: C.card, borderRadius: 18, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: C.border },
  cardTitle: { fontSize: 13, fontWeight: '700', color: C.textPrimary, marginBottom: 14 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.04)' },

  // Monthly comparison
  monthRow:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 8 },
  monthRowSel: { backgroundColor: C.accent + '08', marginHorizontal: -4, paddingHorizontal: 4, borderRadius: 8 },
  monthLabel:  { fontSize: 11, fontWeight: '500', color: C.textSec, width: 44 },
  barsCol:     { flex: 1, gap: 3 },
  barRow:      { flexDirection: 'row', alignItems: 'center', gap: 6 },
  barBg:       { flex: 1, height: 5, backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 3, overflow: 'hidden' },
  barFill:     { height: '100%' as any, borderRadius: 3 },
  barAmt:      { fontSize: 10, color: C.textMicro, width: 58, textAlign: 'right' },
  balBadge:    { fontSize: 11, fontWeight: '700', width: 68, textAlign: 'right' },

  // Distribution
  distRow:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
  distIcon:     { fontSize: 18, width: 26, textAlign: 'center' },
  distBody:     { flex: 1 },
  distTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  distCat:      { fontSize: 13, fontWeight: '600', color: C.textPrimary },
  distRight:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  distDelta:    { fontSize: 11, fontWeight: '600' },
  distAmt:      { fontSize: 13, fontWeight: '700', color: C.textPrimary },

  // Micro progress bar
  microBarBg:   { height: 3, backgroundColor: 'rgba(0,0,0,0.06)', borderRadius: 2, overflow: 'hidden', marginTop: 2 },
  microBarFill: { height: '100%' as any, borderRadius: 2 },

  // Subcategories
  subcatRow:      { paddingVertical: 10 },
  subcatTitleRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  subcatName:     { fontSize: 13, fontWeight: '600', color: C.textPrimary },
  subcatAmt:      { fontSize: 13, fontWeight: '700', color: C.textPrimary },
  subcatShare:    { fontSize: 10, color: C.textMicro, marginTop: 4 },

  // Alert banner
  alertBanner:     { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.red + '12', borderRadius: 12, padding: 12, marginBottom: 10 },
  alertBannerIcon: { fontSize: 16 },
  alertBannerText: { flex: 1, fontSize: 13, color: C.red, fontWeight: '500' },

  // Products
  prodRow:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 10 },
  prodLeft:    { flex: 1, minWidth: 0 },
  prodNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  prodName:    { fontSize: 14, fontWeight: '600', color: C.textPrimary, flexShrink: 1 },
  prodMeta:    { fontSize: 11, color: C.textMicro },
  prodRight:   { alignItems: 'flex-end', gap: 2 },
  expandHint:  { fontSize: 10, color: C.textMicro },

  alertPill:     { backgroundColor: C.red + '15', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  alertPillText: { fontSize: 11, fontWeight: '700', color: C.red },

  expandedBox:  { paddingBottom: 12, paddingTop: 4 },
  historyRow:   { flexDirection: 'row', gap: 12, marginTop: 10, paddingBottom: 4 },
  historyCell:  { alignItems: 'center', minWidth: 52 },
  historyMes:   { fontSize: 10, color: C.textMicro, marginBottom: 2 },
  historyPrice: { fontSize: 12, fontWeight: '600', color: C.textPrimary },

  // Empty states
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyText:  { fontSize: 14, color: C.textSec, textAlign: 'center', lineHeight: 22 },
  emptyMini:  { fontSize: 13, color: C.textMicro, textAlign: 'center', paddingVertical: 20 },
});
