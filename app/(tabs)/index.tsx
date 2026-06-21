import { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Platform, ActivityIndicator, Modal, StatusBar, SafeAreaView,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useExchangeRate } from '@/hooks/useExchangeRate';

// ── Interfaces ────────────────────────────────────────────────────────────────

interface Profile {
  nombre: string; moneda_base: string;
  modulo_ahorros: boolean; modulo_prestamos: boolean; modulo_tarjetas: boolean;
  presupuesto_template: Record<string, number> | null;
}
interface Transaccion {
  id: string; tipo: 'ingreso' | 'gasto'; monto: number; categoria: string;
  descripcion: string | null; metodo_pago: string | null; creado_en: string;
  moneda?: string; tipo_cambio?: number; es_gasto_unico?: boolean | null;
  gastos_recurrentes_id?: string | null;
}
interface Presupuesto { categoria: string; monto_limite: number }

// ── Design tokens ─────────────────────────────────────────────────────────────

const C = {
  screen:     '#F7F8FA',
  hero:       '#080C10',
  heroSurf:   '#111620',
  card:       '#FFFFFF',
  border:     'rgba(0,0,0,0.06)',
  textPrimary:'#0D1117',
  textSec:    '#6B7280',
  textMicro:  '#9CA3AF',
  textHero:   '#FFFFFF',
  textMuted:  'rgba(255,255,255,0.45)',
  textLabel:  'rgba(255,255,255,0.30)',
  accent:     '#7C3AED',
  green:      '#00D084',
  amber:      '#F59E0B',
  red:        '#FF3B30',
};

// ── Constants ─────────────────────────────────────────────────────────────────

const ICON: Record<string, string> = {
  Sueldo:'💼', Bono:'🎁', Freelance:'💻', Inversiones:'📈', Negocio:'🏪',
  Ahorro:'🏦', 'Retiro Ahorro':'💰', 'Pago Tarjeta':'💳', 'Abono Préstamo':'📋',
  Alimentación:'🛒', Transporte:'🚗', Vivienda:'🏠', Entretenimiento:'🎬',
  Salud:'💊', Educación:'📚', Ropa:'👕', Servicios:'⚡', Restaurantes:'🍽️', Otros:'📦',
};
const SYM: Record<string, string> = { PEN:'S/', USD:'$', EUR:'€', BRL:'R$', COP:'$', MXN:'$', ARS:'$', CLP:'$' };
const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

function fmt(n: number, cur: string) {
  return `${SYM[cur] ?? cur} ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [profile,      setProfile]      = useState<Profile | null>(null);
  const [txs,          setTxs]          = useState<Transaccion[]>([]);
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([]);
  const [gastosPorCat, setGastosPorCat] = useState<Record<string, number>>({});
  const [loading,      setLoading]      = useState(true);
  const [showAllCats,        setShowAllCats]        = useState(false);
  const [showQuickAdd,       setShowQuickAdd]       = useState(false);
  const [showProyectadoInfo, setShowProyectadoInfo] = useState(false);
  const [pendingCommits,     setPendingCommits]     = useState<{ id: string; monto: number; descripcion: string | null }[]>([]);

  const { rate } = useExchangeRate();

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !active) return;
        const now          = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const periodoDate  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

        const [pRes, txRes, budRes, recRes] = await Promise.all([
          supabase.from('profiles')
            .select('nombre,moneda_base,modulo_ahorros,modulo_prestamos,modulo_tarjetas,presupuesto_template')
            .eq('id', user.id).single(),
          supabase.from('transacciones')
            .select('id,tipo,monto,categoria,descripcion,metodo_pago,creado_en,moneda,tipo_cambio,es_gasto_unico,gastos_recurrentes_id')
            .eq('user_id', user.id).eq('activo', true)
            .gte('creado_en', startOfMonth)
            .order('creado_en', { ascending: false }).limit(200),
          supabase.from('presupuestos')
            .select('categoria,monto_limite')
            .eq('user_id', user.id).eq('periodo', periodoDate),
          // Vista que ya calcula aplicado para recurrentes Y cuotas
          supabase.from('v_gastos_programados_mes')
            .select('id,monto_cuota,descripcion,tipo_programado')
            .eq('aplicado', false),
        ]);

        if (!active) return;
        if (pRes.data)  setProfile(pRes.data as Profile);
        if (txRes.data) setTxs(txRes.data as Transaccion[]);

        const budData = budRes.data ?? [];
        if (budData.length === 0 && pRes.data) {
          const template = (pRes.data as any).presupuesto_template as Record<string, number> | null;
          if (template && Object.keys(template).length > 0) {
            const upserts = Object.entries(template).map(([cat, monto]) => ({
              user_id: user.id, categoria: cat, monto_limite: monto, periodo: periodoDate,
            }));
            const { data: created } = await supabase.from('presupuestos')
              .upsert(upserts, { onConflict: 'user_id,categoria,periodo' })
              .select('categoria,monto_limite');
            if (active && created) setPresupuestos(created as Presupuesto[]);
          } else {
            setPresupuestos([]);
          }
        } else {
          setPresupuestos(budData as Presupuesto[]);
        }

        // Compromisos pendientes = recurrentes + cuotas no aplicados este mes (vía vista)
        if (active && recRes.data) {
          setPendingCommits(
            (recRes.data as any[]).map(r => ({
              id:          r.id,
              monto:       Number(r.monto_cuota),
              descripcion: r.descripcion,
            }))
          );
        }

        const gpc: Record<string, number> = {};
        (txRes.data ?? []).filter(t => t.tipo === 'gasto').forEach(t => {
          const m   = Number(t.monto);
          const mon = (t as any).moneda ?? 'PEN';
          const tc  = (t as any).tipo_cambio ?? 1;
          const pen = mon === 'USD' ? m * tc : m;
          gpc[t.categoria] = (gpc[t.categoria] ?? 0) + pen;
        });
        setGastosPorCat(gpc);
        setLoading(false);
      })();
      return () => { active = false; };
    }, [])
  );

  // ── Derived ───────────────────────────────────────────────────────────────

  const currency = profile?.moneda_base ?? 'PEN';
  const now      = new Date();
  const initial  = profile?.nombre?.charAt(0).toUpperCase() ?? '?';

  function toPENAmount(tx: Transaccion): number {
    const m   = Number(tx.monto);
    const mon = tx.moneda ?? 'PEN';
    if (mon === 'PEN') return m;
    return m * (tx.tipo_cambio ?? rate.venta);
  }

  const income         = txs.filter(t => t.tipo === 'ingreso').reduce((s, t) => s + toPENAmount(t), 0);
  // Separate regular expenses from one-time (únicos) for accurate run-rate
  const expensesRec    = txs.filter(t => t.tipo === 'gasto' && !t.es_gasto_unico).reduce((s, t) => s + toPENAmount(t), 0);
  const expensesUnicos = txs.filter(t => t.tipo === 'gasto' &&  t.es_gasto_unico).reduce((s, t) => s + toPENAmount(t), 0);
  const expenses       = expensesRec + expensesUnicos;
  const balance        = income - expenses;

  const daysInMonth  = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysElapsed  = now.getDate();
  const totalPres    = presupuestos.reduce((s, p) => s + p.monto_limite, 0);
  // Run-rate: project regular expenses only; únicos are already paid, not repeated
  const runRate            = daysElapsed > 0 ? (expensesRec / daysElapsed) * daysInMonth : 0;
  const totalPendingCommits = pendingCommits.reduce((s, r) => s + r.monto, 0);
  const proyectado          = runRate + expensesUnicos + totalPendingCommits;
  const presProgress = totalPres > 0 ? Math.min(expenses / totalPres, 1) : 0;
  const proyColor    = totalPres > 0 && proyectado > totalPres      ? C.red
                     : totalPres > 0 && proyectado > totalPres * 0.85 ? C.amber
                     : C.green;

  // Status
  let statusColor = C.accent;
  let statusTitle = 'Sin presupuesto definido';
  let statusSub   = `Llevas ${fmt(expenses, currency)} gastados este mes`;

  if (totalPres > 0) {
    const pct = proyectado / totalPres;
    if (pct < 0.85) {
      statusColor = C.green;
      statusTitle = '¡Vas por buen camino!';
      statusSub   = `Día ${daysElapsed} de ${daysInMonth} · ${Math.round(presProgress * 100)}% del presupuesto`;
    } else if (pct < 1.0) {
      statusColor = C.amber;
      statusTitle = 'Cuidado con el ritmo';
      statusSub   = `Día ${daysElapsed} de ${daysInMonth} · ${Math.round(presProgress * 100)}% del presupuesto`;
    } else {
      statusColor = C.red;
      statusTitle = 'Alerta de sobregasto';
      statusSub   = `Día ${daysElapsed} de ${daysInMonth} · ${Math.round(presProgress * 100)}% del presupuesto`;
    }
  }

  // Hero number: run-rate if budget exists, else balance
  const heroNumber = totalPres > 0 ? proyectado : balance;
  const heroLabel  = totalPres > 0 ? 'PROYECCIÓN A FIN DE MES' : 'BALANCE DISPONIBLE';

  // Top categories
  const sortedCats  = Object.entries(gastosPorCat).sort(([, a], [, b]) => b - a);
  const visibleCats = showAllCats ? sortedCats : sortedCats.slice(0, 3);
  const recent      = txs.slice(0, 3);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={s.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.screen} />

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
      >
        {/* ── Top bar ── */}
        <SafeAreaView style={{ backgroundColor: C.screen }}>
          <View style={s.topBar}>
            <View>
              <Text style={s.greeting}>
                {loading ? '' : `Hola, ${profile?.nombre ?? ''}`}
              </Text>
              <Text style={s.subGreeting}>
                {MONTHS[now.getMonth()]} · {now.getFullYear()}
              </Text>
            </View>
            <TouchableOpacity
              style={s.avatar}
              onPress={() => router.push('/(tabs)/mas')}
              activeOpacity={0.7}
            >
              <Text style={s.avatarText}>{initial}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>

        <View style={s.container}>

          {/* ════ ZONA 1 — HÉROE ════ */}
          <View style={s.hero}>
            <Text style={s.heroRunLabel}>{heroLabel}</Text>

            {loading ? (
              <ActivityIndicator color={C.textMuted} style={{ marginVertical: 18 }} />
            ) : (
              <Text
                style={[s.heroRunAmt, { color: totalPres > 0 ? C.textHero : (balance >= 0 ? C.green : C.red) }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {fmt(heroNumber, currency)}
              </Text>
            )}

            <View style={s.heroDivider} />

            <View style={s.heroStatusRow}>
              <View style={[s.heroDot, { backgroundColor: statusColor }]} />
              <Text style={s.heroStatusText}>{statusTitle}</Text>
            </View>
            <Text style={s.heroStatusSub}>{statusSub}</Text>

            {totalPres > 0 && (
              <View style={s.heroBarBg}>
                <View style={[s.heroBarFill, {
                  width: `${Math.round(presProgress * 100)}%` as any,
                  backgroundColor: statusColor,
                }]} />
              </View>
            )}
          </View>

          {/* ════ ZONA 2 — BENTO: Real + Presupuestado (2 cols) ════ */}
          <View style={s.bentoRow}>
            <View style={s.bentoCard}>
              <Text style={s.bentoLabel}>REAL</Text>
              <Text style={s.bentoAmt} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.55}>
                {loading ? '—' : fmt(expenses, currency)}
              </Text>
              <Text style={s.bentoSub}>gastado</Text>
            </View>
            <View style={[s.bentoCard, { marginLeft: 8 }]}>
              <Text style={s.bentoLabel}>PRESUPUESTADO</Text>
              <Text style={s.bentoAmt} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.55}>
                {loading ? '—' : totalPres > 0 ? fmt(totalPres, currency) : '—'}
              </Text>
              <Text style={s.bentoSub}>límite</Text>
            </View>
          </View>

          {/* ── Proyectado: full-width featured card con desglose ── */}
          <TouchableOpacity
            style={s.proyStandalone}
            onPress={() => setShowProyectadoInfo(v => !v)}
            activeOpacity={0.85}
          >
            <View style={s.proyHeader}>
              <Text style={s.bentoLabel}>PROYECTADO A FIN DE MES</Text>
              <Text style={s.proyToggle}>{showProyectadoInfo ? '▲ Ocultar' : '▼ Ver cálculo'}</Text>
            </View>
            <Text
              style={[s.proyAmt, { color: loading ? C.textPrimary : proyColor }]}
              numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}
            >
              {loading ? '—' : fmt(proyectado, currency)}
            </Text>

            {showProyectadoInfo && !loading && (
              <View style={s.proyDetail}>
                <View style={s.proyDetailRow}>
                  <Text style={s.proyDetailLabel}>Gastos regulares (hoy)</Text>
                  <Text style={s.proyDetailVal}>{fmt(expensesRec, currency)}</Text>
                </View>
                <View style={s.proyDetailRow}>
                  <Text style={s.proyDetailLabel}>÷ Días transcurridos</Text>
                  <Text style={s.proyDetailVal}>día {daysElapsed} de {daysInMonth}</Text>
                </View>
                <View style={s.proyDetailRow}>
                  <Text style={s.proyDetailLabel}>× Días del mes</Text>
                  <Text style={s.proyDetailVal}>{daysInMonth} días</Text>
                </View>
                <View style={s.proyDetailRow}>
                  <Text style={s.proyDetailLabel}>= Run-rate</Text>
                  <Text style={s.proyDetailVal}>{fmt(runRate, currency)}</Text>
                </View>
                {expensesUnicos > 0 && (
                  <View style={s.proyDetailRow}>
                    <Text style={s.proyDetailLabel}>+ Gastos únicos ⚡</Text>
                    <Text style={s.proyDetailVal}>{fmt(expensesUnicos, currency)}</Text>
                  </View>
                )}
                {totalPendingCommits > 0 && (
                  <View style={s.proyDetailRow}>
                    <Text style={s.proyDetailLabel}>+ Compromisos pendientes 🔄</Text>
                    <Text style={s.proyDetailVal}>{fmt(totalPendingCommits, currency)}</Text>
                  </View>
                )}
                <View style={s.proyDetailSep} />
                <View style={s.proyDetailRow}>
                  <Text style={[s.proyDetailLabel, { fontWeight: '700', color: C.textPrimary }]}>= Proyectado total</Text>
                  <Text style={[s.proyDetailVal, { fontWeight: '700', color: proyColor }]}>{fmt(proyectado, currency)}</Text>
                </View>
                {totalPres > 0 && (
                  <Text style={s.proyDetailNote}>
                    Representa el {Math.round((proyectado / totalPres) * 100)}% del presupuesto ({fmt(totalPres, currency)})
                  </Text>
                )}
              </View>
            )}

            {!showProyectadoInfo && totalPres > 0 && (
              <View style={[s.thinBarBg, { marginTop: 12 }]}>
                <View style={[s.thinBarFill, {
                  width: `${Math.min(Math.round((proyectado / totalPres) * 100), 100)}%` as any,
                  backgroundColor: proyColor,
                }]} />
              </View>
            )}
          </TouchableOpacity>

          {/* ── Balance card ── */}
          <View style={s.balanceCard}>
            <Text style={s.balanceTopLabel}>BALANCE DISPONIBLE</Text>
            {loading ? (
              <ActivityIndicator color={C.textSec} style={{ marginVertical: 8 }} />
            ) : (
              <Text style={[s.balanceAmt, { color: balance >= 0 ? C.green : C.red }]}>
                {fmt(balance, currency)}
              </Text>
            )}
            <View style={s.balanceInOut}>
              <View style={s.balanceCol}>
                <Text style={s.balanceColLabel}>↑ Ingresos</Text>
                <Text style={[s.balanceColAmt, { color: C.green }]}>
                  {loading ? '—' : fmt(income, currency)}
                </Text>
              </View>
              <View style={s.balanceSep} />
              <View style={s.balanceCol}>
                <Text style={s.balanceColLabel}>↓ Gastos</Text>
                <Text style={[s.balanceColAmt, { color: C.red }]}>
                  {loading ? '—' : fmt(expenses, currency)}
                </Text>
              </View>
            </View>
          </View>

          {/* ════ ZONA 3a — TOP CATEGORÍAS ════ */}
          {!loading && sortedCats.length > 0 && (
            <View style={s.section}>
              <View style={s.sectionHead}>
                <Text style={s.sectionTitle}>Top categorías</Text>
                {sortedCats.length > 3 && (
                  <TouchableOpacity onPress={() => setShowAllCats(v => !v)} activeOpacity={0.7}>
                    <Text style={s.sectionLink}>
                      {showAllCats ? 'Ver menos' : `Ver más (${sortedCats.length - 3})`} ▸
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={s.catCard}>
                {visibleCats.map(([cat, gasto], i) => {
                  const pres  = presupuestos.find(p => p.categoria === cat);
                  const limit = pres?.monto_limite ?? 0;
                  const pct   = limit > 0 ? Math.min(gasto / limit, 1) : 0;
                  const barColor = limit > 0
                    ? (pct >= 0.9 ? C.red : pct >= 0.7 ? C.amber : C.green)
                    : C.textMicro;
                  return (
                    <View key={cat}>
                      <TouchableOpacity
                        style={s.catRow}
                        activeOpacity={0.65}
                        onPress={() => router.push(`/categoria-detalle?categoria=${encodeURIComponent(cat)}&presupuesto=${limit}&moneda=${currency}`)}
                      >
                        <Text style={s.catIcon}>{ICON[cat] ?? '📦'}</Text>
                        <View style={s.catBody}>
                          <View style={s.catTop}>
                            <Text style={s.catName}>{cat}</Text>
                            <Text style={[s.catAmt, { color: barColor }]}>{fmt(gasto, currency)}</Text>
                          </View>
                          <View style={s.thinBarBg}>
                            <View style={[s.thinBarFill, {
                              width: limit > 0 ? (`${Math.round(pct * 100)}%` as any) : '0%',
                              backgroundColor: barColor,
                            }]} />
                          </View>
                          {limit > 0 && (
                            <Text style={s.catLimit}>
                              {Math.round(pct * 100)}% de {fmt(limit, currency)}
                            </Text>
                          )}
                        </View>
                      </TouchableOpacity>
                      {i < visibleCats.length - 1 && <View style={s.catSep} />}
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* ════ ZONA 3b — ÚLTIMOS 3 MOVIMIENTOS ════ */}
          <View style={s.section}>
            <View style={s.sectionHead}>
              <Text style={s.sectionTitle}>Últimos movimientos</Text>
              <TouchableOpacity onPress={() => router.push('/(tabs)/transacciones')} activeOpacity={0.7}>
                <Text style={s.sectionLink}>Ver todo →</Text>
              </TouchableOpacity>
            </View>

            {loading ? (
              <ActivityIndicator color={C.textMicro} style={{ marginVertical: 20 }} />
            ) : recent.length === 0 ? (
              <View style={s.emptyTx}>
                <Text style={s.emptyTxIcon}>💸</Text>
                <Text style={s.emptyTxTitle}>Sin movimientos este mes</Text>
                <Text style={s.emptyTxSub}>Usa el botón para registrar el primero.</Text>
              </View>
            ) : (
              <View style={s.txCard}>
                {recent.map((tx, i) => (
                  <View key={tx.id}>
                    <View style={s.txRow}>
                      <View style={s.txIconBox}>
                        <Text style={{ fontSize: 16 }}>{ICON[tx.categoria] ?? '📦'}</Text>
                      </View>
                      <View style={s.txBody}>
                        <Text style={s.txDesc} numberOfLines={1}>
                          {tx.descripcion || tx.categoria}
                        </Text>
                        <Text style={s.txMeta}>
                          {tx.categoria} · {new Date(tx.creado_en).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' })}
                        </Text>
                      </View>
                      <Text style={[s.txAmt, { color: tx.tipo === 'ingreso' ? C.green : C.red }]}>
                        {tx.tipo === 'ingreso' ? '+' : '−'}{fmt(Number(tx.monto), currency)}
                      </Text>
                    </View>
                    {i < recent.length - 1 && <View style={s.txSep} />}
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={{ height: 160 }} />
        </View>
      </ScrollView>

      {/* ── FAB — único punto de registro ── */}
      <TouchableOpacity
        style={s.fab}
        onPress={() => setShowQuickAdd(true)}
        activeOpacity={0.75}
      >
        <Text style={s.fabText}>＋  Anotar</Text>
      </TouchableOpacity>

      {/* ── Quick Add bottom sheet ── */}
      <Modal visible={showQuickAdd} animationType="slide" transparent>
        <TouchableOpacity
          style={s.backdrop}
          activeOpacity={1}
          onPress={() => setShowQuickAdd(false)}
        >
          <View style={s.sheet}>
            <View style={s.sheetPill} />
            <Text style={s.sheetTitle}>¿Qué quieres registrar?</Text>
            <View style={s.sheetDivider} />
            {([
              {
                icon: '＋', label: 'Registrar Ingreso',    sub: 'Sueldo, freelance, transferencias',
                bg: '#F0FDF4', fg: '#15803D', show: true,
                fn: () => { setShowQuickAdd(false); router.push(`/registrar?tipo=ingreso&moneda=${currency}`); },
              },
              {
                icon: '－', label: 'Registrar Gasto',      sub: 'Alimentación, transporte, servicios',
                bg: '#FFF1F2', fg: '#BE123C', show: true,
                fn: () => { setShowQuickAdd(false); router.push(`/registrar?tipo=gasto&moneda=${currency}`); },
              },
              {
                icon: '💳', label: 'Pagar deuda',          sub: 'Tarjeta de crédito o préstamo',
                bg: '#FFFBEB', fg: '#92400E', show: !!(profile?.modulo_prestamos || profile?.modulo_tarjetas),
                fn: () => { setShowQuickAdd(false); router.push(`/pagos?moneda=${currency}`); },
              },
              {
                icon: '🏦', label: 'Movimiento de ahorro', sub: 'Abono, retiro o interés',
                bg: '#EFF6FF', fg: '#1D4ED8', show: !!profile?.modulo_ahorros,
                fn: () => { setShowQuickAdd(false); router.push(`/ahorros?moneda=${currency}`); },
              },
            ] as const).filter(o => o.show).map((opt, i, arr) => (
              <View key={opt.label}>
                <TouchableOpacity style={s.sheetOpt} onPress={opt.fn} activeOpacity={0.7}>
                  <View style={[s.sheetOptIcon, { backgroundColor: opt.bg }]}>
                    <Text style={{ fontSize: 22 }}>{opt.icon}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.sheetOptTitle, { color: opt.fg }]}>{opt.label}</Text>
                    <Text style={s.sheetOptSub}>{opt.sub}</Text>
                  </View>
                  <Text style={s.chevron}>›</Text>
                </TouchableOpacity>
                {i < arr.length - 1 && <View style={s.sheetSep} />}
              </View>
            ))}
            <TouchableOpacity style={s.sheetCancel} onPress={() => setShowQuickAdd(false)} activeOpacity={0.7}>
              <Text style={s.sheetCancelText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.screen },
  scroll: { flexGrow: 1 },
  container: { paddingHorizontal: 16, paddingTop: 6 },

  // ── Top bar
  topBar:     {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: Platform.OS === 'android' ? 44 : 14, paddingBottom: 12,
  },
  greeting:   { fontSize: 18, fontWeight: '700', color: C.textPrimary, letterSpacing: -0.2 },
  subGreeting:{ fontSize: 12, color: C.textMicro, marginTop: 2, textTransform: 'capitalize', letterSpacing: 0.2 },
  avatar:     {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: C.hero, justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  // ── ZONA 1: Hero
  hero: {
    backgroundColor: C.hero,
    borderRadius: 24,
    padding: 24,
    marginBottom: 10,
  },
  heroRunLabel: {
    fontSize: 10, fontWeight: '600', color: C.textLabel,
    textTransform: 'uppercase', letterSpacing: 2.5, marginBottom: 10,
  },
  heroRunAmt: {
    fontSize: 52, fontWeight: '800', color: C.textHero,
    letterSpacing: -2, marginBottom: 20,
  },
  heroDivider: {
    height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginBottom: 16,
  },
  heroStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  heroDot:       { width: 8, height: 8, borderRadius: 4 },
  heroStatusText:{ fontSize: 17, fontWeight: '700', color: C.textHero, letterSpacing: -0.2 },
  heroStatusSub: { fontSize: 12, color: C.textMuted, marginBottom: 14, letterSpacing: 0.1 },
  heroBarBg:     {
    height: 2, backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 1, overflow: 'hidden',
  },
  heroBarFill:   { height: '100%' as any, borderRadius: 1 },

  // ── ZONA 2: Bento
  bentoRow:  { flexDirection: 'row', marginBottom: 10 },
  bentoCard: {
    flex: 1, backgroundColor: C.card, borderRadius: 18,
    padding: 16, borderWidth: 1, borderColor: C.border,
  },
  bentoLabel: {
    fontSize: 9, fontWeight: '600', color: C.textMicro,
    textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8,
  },
  bentoAmt: {
    fontSize: 18, fontWeight: '700', color: C.textPrimary,
    letterSpacing: -0.4, marginBottom: 4,
  },
  bentoSub: { fontSize: 10, color: C.textMicro },

  // ── Proyectado card (standalone — sin heredar flex:1 de bentoCard)
  proyStandalone: {
    backgroundColor: C.card, borderRadius: 18,
    padding: 16, borderWidth: 1, borderColor: C.border,
    marginBottom: 10,
  },
  proyHeader:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  proyToggle:     { fontSize: 11, color: C.accent, fontWeight: '500' },
  proyAmt:        { fontSize: 26, fontWeight: '800', letterSpacing: -0.6 },
  proyDetail:     { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border },
  proyDetailRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 },
  proyDetailLabel:{ fontSize: 12, color: C.textSec },
  proyDetailVal:  { fontSize: 12, color: C.textPrimary, fontWeight: '600' },
  proyDetailSep:  { height: 1, backgroundColor: C.border, marginVertical: 8 },
  proyDetailNote: { fontSize: 11, color: C.textMicro, marginTop: 4 },

  // ── Balance card
  balanceCard: {
    backgroundColor: C.card, borderRadius: 18, padding: 20,
    marginBottom: 10, borderWidth: 1, borderColor: C.border,
  },
  balanceTopLabel: {
    fontSize: 9, fontWeight: '600', color: C.textMicro,
    textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8,
  },
  balanceAmt:     { fontSize: 30, fontWeight: '800', letterSpacing: -0.8, marginBottom: 16 },
  balanceInOut:   { flexDirection: 'row' },
  balanceCol:     { flex: 1 },
  balanceSep:     { width: 1, backgroundColor: C.border, marginHorizontal: 16 },
  balanceColLabel:{ fontSize: 11, color: C.textMicro, marginBottom: 4 },
  balanceColAmt:  { fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },

  // ── Sections
  section:     { marginBottom: 10 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle:{ fontSize: 14, fontWeight: '700', color: C.textPrimary, letterSpacing: -0.1 },
  sectionLink: { fontSize: 12, color: C.accent, fontWeight: '500' },

  // ── Category card
  catCard:    {
    backgroundColor: C.card, borderRadius: 18, overflow: 'hidden',
    borderWidth: 1, borderColor: C.border,
  },
  catRow:     { paddingHorizontal: 16, paddingVertical: 14, flexDirection: 'row', alignItems: 'center' },
  catIcon:    { fontSize: 15, marginRight: 12, width: 22, textAlign: 'center' },
  catBody:    { flex: 1 },
  catTop:     { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  catName:    { fontSize: 14, fontWeight: '600', color: C.textPrimary },
  catAmt:     { fontSize: 13, fontWeight: '700' },
  catLimit:   { fontSize: 10, color: C.textMicro, marginTop: 4 },
  catSep:     { height: 1, backgroundColor: C.border, marginLeft: 50 },
  thinBarBg:  { height: 2, backgroundColor: '#F3F4F6', borderRadius: 1, overflow: 'hidden' },
  thinBarFill:{ height: '100%' as any, borderRadius: 1 },

  // ── Transaction card
  txCard:    {
    backgroundColor: C.card, borderRadius: 18, overflow: 'hidden',
    borderWidth: 1, borderColor: C.border,
  },
  txRow:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  txIconBox: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: C.screen,
    justifyContent: 'center', alignItems: 'center', marginRight: 12, flexShrink: 0,
  },
  txBody:    { flex: 1, minWidth: 0 },
  txDesc:    { fontSize: 14, fontWeight: '500', color: C.textPrimary, marginBottom: 2 },
  txMeta:    { fontSize: 11, color: C.textMicro },
  txAmt:     { fontSize: 13, fontWeight: '700', marginLeft: 8, flexShrink: 0 },
  txSep:     { height: 1, backgroundColor: C.border, marginLeft: 64 },
  emptyTx:   { backgroundColor: C.card, borderRadius: 18, padding: 32, alignItems: 'center',
               borderWidth: 1, borderColor: C.border },
  emptyTxIcon: { fontSize: 32, marginBottom: 10 },
  emptyTxTitle:{ fontSize: 14, fontWeight: '600', color: C.textPrimary, marginBottom: 4 },
  emptyTxSub:  { fontSize: 12, color: C.textMicro, textAlign: 'center' },

  // ── FAB
  fab: {
    position: 'absolute', bottom: 28, right: 20,
    backgroundColor: C.hero, borderRadius: 28,
    paddingHorizontal: 22, paddingVertical: 15,
  },
  fabText: { color: '#fff', fontSize: 14, fontWeight: '700', letterSpacing: 0.2 },

  // ── Quick Add sheet
  backdrop:        { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet:           {
    backgroundColor: C.card, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingBottom: Platform.OS === 'ios' ? 36 : 20,
  },
  sheetPill:       {
    width: 36, height: 4, backgroundColor: '#E5E7EB', borderRadius: 2,
    alignSelf: 'center', marginTop: 10, marginBottom: 14,
  },
  sheetTitle:      { fontSize: 15, fontWeight: '700', color: C.textPrimary, paddingHorizontal: 22, marginBottom: 12 },
  sheetDivider:    { height: 1, backgroundColor: C.border },
  sheetOpt:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, paddingVertical: 14, gap: 14 },
  sheetOptIcon:    { width: 46, height: 46, borderRadius: 13, justifyContent: 'center', alignItems: 'center' },
  sheetOptTitle:   { fontSize: 14, fontWeight: '600', marginBottom: 2 },
  sheetOptSub:     { fontSize: 12, color: C.textMicro },
  chevron:         { fontSize: 20, color: '#D1D5DB' },
  sheetSep:        { height: 1, backgroundColor: C.border, marginLeft: 82 },
  sheetCancel:     {
    margin: 16, backgroundColor: C.screen, borderRadius: 14,
    paddingVertical: 14, alignItems: 'center',
  },
  sheetCancelText: { fontSize: 14, fontWeight: '600', color: C.textSec },
});
