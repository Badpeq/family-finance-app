import { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Platform, ActivityIndicator, Modal, TextInput,
  StatusBar, SafeAreaView,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';

interface Profile     { nombre: string; moneda_base: string }
interface Transaccion { id: string; tipo: 'ingreso'|'gasto'; monto: number; categoria: string; descripcion: string|null; metodo_pago: string|null; creado_en: string }
interface Presupuesto { categoria: string; monto_limite: number }

const ICON: Record<string, string> = {
  Sueldo:'💼', Freelance:'💻', Inversiones:'📈', Negocio:'🏪',
  Ahorro:'🏦', 'Retiro Ahorro':'💰', 'Pago Tarjeta':'💳', 'Abono Préstamo':'📋',
  Alimentación:'🛒', Transporte:'🚗', Vivienda:'🏠', Entretenimiento:'🎬',
  Salud:'💊', Educación:'📚', Ropa:'👕', Servicios:'⚡', Otros:'📦',
};
const CATS_GASTO = ['Alimentación','Transporte','Vivienda','Entretenimiento','Salud','Educación','Ropa','Servicios','Otros'];
const SYM: Record<string,string> = { PEN:'S/', USD:'$', EUR:'€', BRL:'R$', COP:'$', MXN:'$', ARS:'$', CLP:'$' };
const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

function fmt(n: number, cur: string) {
  return `${SYM[cur] ?? cur} ${n.toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
}

function budgetColor(pct: number) {
  if (pct >= 0.9) return '#DC2626';
  if (pct >= 0.7) return '#F59E0B';
  return '#22C55E';
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(...values, 1);
  return (
    <View style={{ flexDirection:'row', alignItems:'flex-end', height:20, gap:2 }}>
      {values.map((v, i) => (
        <View key={i} style={{
          width: 3,
          height: Math.max(2, (v / max) * 20),
          backgroundColor: color,
          borderRadius: 2,
          opacity: 0.3 + (i / Math.max(values.length - 1, 1)) * 0.7,
        }} />
      ))}
    </View>
  );
}

export default function Dashboard() {
  const [profile,      setProfile]      = useState<Profile|null>(null);
  const [txs,          setTxs]          = useState<Transaccion[]>([]);
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([]);
  const [gastosPorCat, setGastosPorCat] = useState<Record<string,number>>({});
  const [loading,      setLoading]      = useState(true);

  // Quick Add modal
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  // Presupuesto add modal
  const [showNewBudget,  setShowNewBudget]  = useState(false);
  const [newBudCat,      setNewBudCat]      = useState('');
  const [newBudMonto,    setNewBudMonto]    = useState('');
  const [newBudError,    setNewBudError]    = useState('');
  const [newBudSaving,   setNewBudSaving]   = useState(false);
  const [showBudPicker,  setShowBudPicker]  = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        setLoading(true);
        const { data:{ user } } = await supabase.auth.getUser();
        if (!user || !active) return;
        const now          = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const periodoDate  = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;

        const [pRes, txRes, budRes] = await Promise.all([
          supabase.from('profiles').select('nombre,moneda_base').eq('id', user.id).single(),
          supabase.from('transacciones')
            .select('id,tipo,monto,categoria,descripcion,metodo_pago,creado_en')
            .eq('user_id', user.id).eq('activo', true)
            .gte('creado_en', startOfMonth)
            .order('creado_en', { ascending: false }).limit(100),
          supabase.from('presupuestos')
            .select('categoria,monto_limite')
            .eq('user_id', user.id).eq('periodo', periodoDate),
        ]);

        if (!active) return;
        if (pRes.data)   setProfile(pRes.data as Profile);
        if (txRes.data)  setTxs(txRes.data as Transaccion[]);
        if (budRes.data) setPresupuestos(budRes.data as Presupuesto[]);

        const gpc: Record<string,number> = {};
        (txRes.data ?? []).filter(t => t.tipo === 'gasto').forEach(t => {
          gpc[t.categoria] = (gpc[t.categoria] ?? 0) + Number(t.monto);
        });
        setGastosPorCat(gpc);
        setLoading(false);
      })();
      return () => { active = false; };
    }, [])
  );

  const currency   = profile?.moneda_base ?? 'PEN';
  const now        = new Date();
  const income     = txs.filter(t => t.tipo === 'ingreso').reduce((s,t) => s + Number(t.monto), 0);
  const expenses   = txs.filter(t => t.tipo === 'gasto').reduce((s,t)  => s + Number(t.monto), 0);
  const balance    = income - expenses;
  const recent     = txs.slice(0, 5);

  // Sparklines: últimos 7 días
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().slice(0, 10);
  });
  const sparkIn  = last7.map(day => txs.filter(t => t.tipo === 'ingreso' && t.creado_en.slice(0,10) === day).reduce((s,t) => s + Number(t.monto), 0));
  const sparkOut = last7.map(day => txs.filter(t => t.tipo === 'gasto'   && t.creado_en.slice(0,10) === day).reduce((s,t) => s + Number(t.monto), 0));

  const periodoDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;

  const handleCreateBudget = async () => {
    if (!newBudCat) { setNewBudError('Selecciona una categoría.'); return; }
    const monto = parseFloat(newBudMonto.replace(',','.'));
    if (isNaN(monto) || monto <= 0) { setNewBudError('Ingresa un monto límite válido.'); return; }
    setNewBudError('');
    setNewBudSaving(true);
    const { data:{ user } } = await supabase.auth.getUser();
    if (!user) { setNewBudSaving(false); return; }
    const { error } = await supabase.from('presupuestos').upsert({
      user_id: user.id, categoria: newBudCat, monto_limite: monto, periodo: periodoDate,
    }, { onConflict: 'user_id,categoria,periodo' });
    if (error) { setNewBudError(error.message); setNewBudSaving(false); return; }
    setPresupuestos(prev => {
      const idx = prev.findIndex(p => p.categoria === newBudCat);
      if (idx >= 0) return prev.map((p,i) => i === idx ? {...p, monto_limite: monto} : p);
      return [...prev, { categoria: newBudCat, monto_limite: monto }];
    });
    setShowNewBudget(false);
    setNewBudCat('');
    setNewBudMonto('');
    setNewBudSaving(false);
  };

  const initial = profile?.nombre?.charAt(0).toUpperCase() ?? '?';

  return (
    <View style={{ flex: 1, backgroundColor: '#F8F9FB' }}>
      <StatusBar barStyle="dark-content" backgroundColor="#F8F9FB" />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Header ── */}
        <SafeAreaView style={{ backgroundColor: '#F8F9FB' }}>
          <View style={styles.header}>
            <View>
              <Text style={styles.greeting}>{loading ? '...' : `Hola, ${profile?.nombre ?? ''}! 👋`}</Text>
              <Text style={styles.subGreeting}>{MONTHS[now.getMonth()]} {now.getFullYear()}</Text>
            </View>
            <TouchableOpacity style={styles.avatar}>
              <Text style={styles.avatarText}>{initial}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>

        <View style={styles.container}>

          {/* ── Balance Hero Card ── */}
          <View style={styles.heroCard}>
            <Text style={styles.heroLabel}>Balance disponible</Text>
            {loading
              ? <ActivityIndicator color="rgba(255,255,255,0.7)" style={{ marginVertical: 12 }} />
              : <Text style={styles.heroBalance}>{fmt(balance, currency)}</Text>
            }
            <View style={styles.heroRow}>
              <View style={styles.heroStat}>
                <View style={styles.heroStatTop}>
                  <View style={[styles.heroBadge, { backgroundColor: 'rgba(34,197,94,0.25)' }]}>
                    <Text style={styles.heroBadgeText}>↑</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.heroStatLabel}>Ingresos</Text>
                    <Text style={[styles.heroStatAmt, { color: '#86EFAC' }]}>
                      {loading ? '—' : fmt(income, currency)}
                    </Text>
                  </View>
                </View>
                {!loading && <Sparkline values={sparkIn} color="#86EFAC" />}
              </View>
              <View style={styles.heroDiv} />
              <View style={styles.heroStat}>
                <View style={styles.heroStatTop}>
                  <View style={[styles.heroBadge, { backgroundColor: 'rgba(239,68,68,0.25)' }]}>
                    <Text style={styles.heroBadgeText}>↓</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.heroStatLabel}>Gastos</Text>
                    <Text style={[styles.heroStatAmt, { color: '#FCA5A5' }]}>
                      {loading ? '—' : fmt(expenses, currency)}
                    </Text>
                  </View>
                </View>
                {!loading && <Sparkline values={sparkOut} color="#FCA5A5" />}
              </View>
            </View>
          </View>

          {/* ── Acciones rápidas (scroll horizontal) ── */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }} contentContainerStyle={{ gap: 10, paddingRight: 4 }}>
            {[
              { icon:'＋', label:'Ingreso',   bg:'#D1FAE5', fg:'#059669', fn:() => router.push(`/registrar?tipo=ingreso&moneda=${currency}`) },
              { icon:'－', label:'Gasto',     bg:'#FEE2E2', fg:'#DC2626', fn:() => router.push(`/registrar?tipo=gasto&moneda=${currency}`) },
              { icon:'💳', label:'Pagar',     bg:'#FEF3C7', fg:'#92400E', fn:() => router.push(`/pagos?moneda=${currency}`) },
              { icon:'🏦', label:'Ahorros',   bg:'#E0F2FE', fg:'#0369A1', fn:() => router.push(`/ahorros?moneda=${currency}`) },
              { icon:'📋', label:'Préstamos', bg:'#EDE9FE', fg:'#5B21B6', fn:() => router.push(`/prestamos?moneda=${currency}`) },
            ].map(a => (
              <TouchableOpacity key={a.label} style={[styles.chip, { backgroundColor: a.bg }]} onPress={a.fn} activeOpacity={0.75}>
                <Text style={styles.chipIcon}>{a.icon}</Text>
                <Text style={[styles.chipLabel, { color: a.fg }]}>{a.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* ── Presupuestos del mes ── */}
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>📊 Presupuestos</Text>
              <TouchableOpacity onPress={() => { setNewBudCat(''); setNewBudMonto(''); setNewBudError(''); setShowNewBudget(true); }}>
                <Text style={styles.sectionLink}>＋ Agregar</Text>
              </TouchableOpacity>
            </View>
            {!loading && presupuestos.length === 0 && (
              <View style={styles.emptyBudget}>
                <Text style={styles.emptyBudgetText}>
                  Sin presupuestos este mes.{' '}
                  <Text style={{ color: '#7C3AED' }}>Toca "＋ Agregar" para definir límites.</Text>
                </Text>
              </View>
            )}
            {presupuestos.map(p => {
              const gastado = gastosPorCat[p.categoria] ?? 0;
              const pct     = p.monto_limite > 0 ? Math.min(gastado / p.monto_limite, 1) : 0;
              const color   = budgetColor(pct);
              const pctInt  = Math.round(pct * 100);
              return (
                <View key={p.categoria} style={styles.budgetItem}>
                  <View style={styles.budgetItemTop}>
                    <Text style={styles.budgetCat}>{ICON[p.categoria] ?? '📦'} {p.categoria}</Text>
                    <Text style={[styles.budgetPct, { color }]}>{pctInt}%</Text>
                  </View>
                  <View style={styles.barBg}>
                    <View style={[styles.barFill, { width: `${pctInt}%` as any, backgroundColor: color }]} />
                  </View>
                  <View style={styles.budgetItemBot}>
                    <Text style={styles.budgetGastado}>{fmt(gastado, currency)} gastado</Text>
                    <Text style={styles.budgetLimite}>de {fmt(p.monto_limite, currency)}</Text>
                  </View>
                </View>
              );
            })}
          </View>

          {/* ── Últimos movimientos ── */}
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Últimos movimientos</Text>
              <TouchableOpacity onPress={() => router.push('/(tabs)/transacciones')}>
                <Text style={styles.sectionLink}>Ver todo</Text>
              </TouchableOpacity>
            </View>
            {loading ? (
              <ActivityIndicator color="#3B82F6" style={{ marginVertical: 24 }} />
            ) : recent.length === 0 ? (
              <View style={styles.emptyTx}>
                <Text style={{ fontSize: 34, marginBottom: 10 }}>💸</Text>
                <Text style={styles.emptyTxTitle}>Sin movimientos este mes</Text>
                <Text style={styles.emptyTxSub}>Usa los botones de arriba o el botón verde para registrar.</Text>
              </View>
            ) : (
              <View style={styles.txCard}>
                {recent.map((tx, i) => (
                  <View key={tx.id}>
                    <View style={styles.txRow}>
                      <View style={styles.txIconBox}>
                        <Text style={{ fontSize: 18 }}>{ICON[tx.categoria] ?? '📦'}</Text>
                      </View>
                      <View style={styles.txBody}>
                        <Text style={styles.txDesc} numberOfLines={1}>{tx.descripcion || tx.categoria}</Text>
                        <Text style={styles.txMeta}>
                          {tx.categoria} · {new Date(tx.creado_en).toLocaleDateString('es-PE',{day:'2-digit',month:'short'})}
                        </Text>
                      </View>
                      <Text style={[styles.txAmt, tx.tipo === 'ingreso' ? styles.green : styles.red]}>
                        {tx.tipo === 'ingreso' ? '+' : '−'}{fmt(Number(tx.monto), currency)}
                      </Text>
                    </View>
                    {i < recent.length - 1 && <View style={styles.txSep} />}
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={{ height: 100 }} />
        </View>
      </ScrollView>

      {/* ── FAB Quick Add ── */}
      <TouchableOpacity style={styles.fab} onPress={() => setShowQuickAdd(true)} activeOpacity={0.85}>
        <Text style={styles.fabText}>＋ Quick Add</Text>
      </TouchableOpacity>

      {/* ── Quick Add Bottom Sheet ── */}
      <Modal visible={showQuickAdd} animationType="slide" transparent>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setShowQuickAdd(false)}>
          <View style={styles.sheet}>
            <View style={styles.sheetPill} />
            <Text style={styles.sheetTitle}>¿Qué quieres registrar?</Text>
            <View style={styles.sheetDiv} />
            {[
              { icon:'＋', label:'Registrar Ingreso',    sub:'Sueldo, freelance, transferencias', bg:'#D1FAE5', fg:'#059669',
                fn: () => { setShowQuickAdd(false); router.push(`/registrar?tipo=ingreso&moneda=${currency}`); } },
              { icon:'－', label:'Registrar Gasto',      sub:'Alimentación, transporte, servicios', bg:'#FEE2E2', fg:'#DC2626',
                fn: () => { setShowQuickAdd(false); router.push(`/registrar?tipo=gasto&moneda=${currency}`); } },
              { icon:'💳', label:'Pagar deuda',          sub:'Tarjeta de crédito o préstamo', bg:'#FEF3C7', fg:'#92400E',
                fn: () => { setShowQuickAdd(false); router.push(`/pagos?moneda=${currency}`); } },
              { icon:'🏦', label:'Movimiento de ahorro', sub:'Abono, retiro o interés', bg:'#E0F2FE', fg:'#0369A1',
                fn: () => { setShowQuickAdd(false); router.push(`/ahorros?moneda=${currency}`); } },
            ].map((opt, i, arr) => (
              <View key={opt.label}>
                <TouchableOpacity style={styles.sheetOpt} onPress={opt.fn}>
                  <View style={[styles.sheetOptIcon, { backgroundColor: opt.bg }]}>
                    <Text style={{ fontSize: 22 }}>{opt.icon}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sheetOptTitle, { color: opt.fg }]}>{opt.label}</Text>
                    <Text style={styles.sheetOptSub}>{opt.sub}</Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </TouchableOpacity>
                {i < arr.length - 1 && <View style={styles.sheetSep} />}
              </View>
            ))}
            <TouchableOpacity style={styles.sheetCancel} onPress={() => setShowQuickAdd(false)}>
              <Text style={styles.sheetCancelText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Nuevo Presupuesto Modal ── */}
      <Modal visible={showNewBudget} animationType="slide" transparent>
        <View style={styles.formBackdrop}>
          <View style={styles.formSheet}>
            <View style={styles.formHead}>
              <Text style={styles.formTitle}>📊 {presupuestos.find(p=>p.categoria===newBudCat) ? 'Editar' : 'Nuevo'} Presupuesto</Text>
              <TouchableOpacity onPress={() => setShowNewBudget(false)}>
                <Text style={styles.formClose}>Cancelar</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.formBody}>
              <Text style={styles.formLabel}>Categoría *</Text>
              <TouchableOpacity style={styles.formInput} onPress={() => setShowBudPicker(true)}>
                <Text style={newBudCat ? styles.formValText : styles.formPlaceholder}>
                  {newBudCat ? `${ICON[newBudCat] ?? '📦'} ${newBudCat}` : 'Selecciona una categoría'}
                </Text>
              </TouchableOpacity>
              <Text style={styles.formLabel}>Límite mensual ({SYM[currency] ?? currency}) *</Text>
              <TextInput
                style={[styles.formInput, styles.formValText]}
                placeholder="0.00" placeholderTextColor="#9CA3AF"
                keyboardType="decimal-pad" value={newBudMonto} onChangeText={setNewBudMonto}
              />
              {!!newBudError && <Text style={styles.formError}>{newBudError}</Text>}
              <TouchableOpacity
                style={[styles.formSaveBtn, newBudSaving && { opacity: 0.6 }]}
                onPress={handleCreateBudget} disabled={newBudSaving}
              >
                {newBudSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.formSaveText}>Guardar presupuesto</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Categoría Picker ── */}
      <Modal visible={showBudPicker} animationType="slide" transparent>
        <View style={styles.formBackdrop}>
          <View style={[styles.formSheet, { maxHeight: '60%' }]}>
            <View style={styles.formHead}>
              <Text style={styles.formTitle}>Categoría</Text>
              <TouchableOpacity onPress={() => setShowBudPicker(false)}>
                <Text style={styles.formClose}>Cerrar</Text>
              </TouchableOpacity>
            </View>
            {CATS_GASTO.map((cat, i) => (
              <View key={cat}>
                <TouchableOpacity style={styles.catOpt} onPress={() => { setNewBudCat(cat); setShowBudPicker(false); }}>
                  <Text style={styles.catOptText}>{ICON[cat] ?? '📦'} {cat}</Text>
                  {newBudCat === cat && <Text style={{ color: '#7C3AED', fontSize: 18 }}>✓</Text>}
                </TouchableOpacity>
                {i < CATS_GASTO.length - 1 && <View style={styles.sheetSep} />}
              </View>
            ))}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll:       { flexGrow: 1 },
  header:       { flexDirection:'row', justifyContent:'space-between', alignItems:'center',
                  paddingHorizontal:20, paddingTop: Platform.OS === 'android' ? 44 : 12, paddingBottom: 8 },
  greeting:     { fontSize:17, fontWeight:'700', color:'#111827' },
  subGreeting:  { fontSize:12, color:'#9CA3AF', marginTop:1, textTransform:'capitalize' },
  avatar:       { width:40, height:40, borderRadius:20, backgroundColor:'#3B82F6',
                  justifyContent:'center', alignItems:'center' },
  avatarText:   { color:'#fff', fontSize:17, fontWeight:'700' },

  container: { paddingHorizontal: 16, paddingTop: 8 },

  heroCard: {
    backgroundColor: '#0F172A', borderRadius: 24, padding: 24, marginBottom: 16,
    shadowColor: '#0F172A', shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3, shadowRadius: 20, elevation: 10,
  },
  heroLabel:    { fontSize: 11, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1 },
  heroBalance:  { fontSize: 38, fontWeight: '800', color: '#fff', marginTop: 6, marginBottom: 20, letterSpacing: -1 },
  heroRow:      { flexDirection: 'row' },
  heroStat:     { flex: 1 },
  heroStatTop:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  heroBadge:    { width: 28, height: 28, borderRadius: 8, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  heroBadgeText:{ fontSize: 14, fontWeight: '700', color: '#fff' },
  heroStatLabel:{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 2 },
  heroStatAmt:  { fontSize: 13, fontWeight: '700' },
  heroDiv:      { width: 1, height: 44, backgroundColor: 'rgba(255,255,255,0.1)', marginHorizontal: 16, marginTop: 2 },

  chip:      { alignItems:'center', paddingHorizontal:16, paddingVertical:12, borderRadius:16, minWidth:72, gap:4 },
  chipIcon:  { fontSize: 20 },
  chipLabel: { fontSize: 12, fontWeight: '600' },

  section:      { marginBottom: 20 },
  sectionHead:  { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:12 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
  sectionLink:  { fontSize: 13, color: '#3B82F6', fontWeight: '500' },

  emptyBudget:     { backgroundColor:'#fff', borderRadius:14, padding:14,
                     borderLeftWidth:3, borderLeftColor:'#7C3AED' },
  emptyBudgetText: { fontSize:13, color:'#6B7280', lineHeight:20 },
  budgetItem:      { backgroundColor:'#fff', borderRadius:14, padding:14, marginBottom:8,
                     shadowColor:'#000', shadowOpacity:0.04, shadowRadius:4, elevation:1 },
  budgetItemTop:   { flexDirection:'row', justifyContent:'space-between', marginBottom:8 },
  budgetCat:       { fontSize:14, fontWeight:'500', color:'#374151' },
  budgetPct:       { fontSize:13, fontWeight:'700' },
  barBg:           { height:8, backgroundColor:'#F3F4F6', borderRadius:4, overflow:'hidden', marginBottom:6 },
  barFill:         { height:'100%', borderRadius:4 },
  budgetItemBot:   { flexDirection:'row', justifyContent:'space-between' },
  budgetGastado:   { fontSize:11, color:'#6B7280' },
  budgetLimite:    { fontSize:11, color:'#9CA3AF' },

  emptyTx:      { backgroundColor:'#fff', borderRadius:16, padding:28, alignItems:'center' },
  emptyTxTitle: { fontSize:15, fontWeight:'600', color:'#374151', marginBottom:6 },
  emptyTxSub:   { fontSize:13, color:'#9CA3AF', textAlign:'center', lineHeight:19 },
  txCard:       { backgroundColor:'#fff', borderRadius:16, overflow:'hidden',
                  shadowColor:'#000', shadowOpacity:0.04, shadowRadius:6, elevation:1 },
  txRow:        { flexDirection:'row', alignItems:'center', paddingHorizontal:14, paddingVertical:12 },
  txIconBox:    { width:40, height:40, borderRadius:12, backgroundColor:'#F3F4F6',
                  justifyContent:'center', alignItems:'center', marginRight:10, flexShrink:0 },
  txBody:       { flex:1, minWidth:0 },
  txDesc:       { fontSize:14, fontWeight:'600', color:'#111827' },
  txMeta:       { fontSize:11, color:'#9CA3AF', marginTop:1 },
  txAmt:        { fontSize:14, fontWeight:'700', marginLeft:8, flexShrink:0 },
  txSep:        { height:1, backgroundColor:'#F3F4F6', marginLeft:64 },
  green:        { color:'#059669' },
  red:          { color:'#DC2626' },

  fab: {
    position:'absolute', bottom:24, right:20,
    backgroundColor:'#22C55E', borderRadius:28,
    paddingHorizontal:20, paddingVertical:14,
    shadowColor:'#16A34A', shadowOffset:{ width:0, height:4 },
    shadowOpacity:0.45, shadowRadius:10, elevation:8,
  },
  fabText: { color:'#fff', fontSize:15, fontWeight:'700' },

  backdrop:       { flex:1, backgroundColor:'rgba(0,0,0,0.45)', justifyContent:'flex-end' },
  sheet:          { backgroundColor:'#fff', borderTopLeftRadius:28, borderTopRightRadius:28,
                    paddingBottom: Platform.OS === 'ios' ? 36 : 20 },
  sheetPill:      { width:40, height:4, backgroundColor:'#E5E7EB', borderRadius:2,
                    alignSelf:'center', marginTop:10, marginBottom:16 },
  sheetTitle:     { fontSize:16, fontWeight:'700', color:'#111827', paddingHorizontal:20, marginBottom:12 },
  sheetDiv:       { height:1, backgroundColor:'#F3F4F6' },
  sheetOpt:       { flexDirection:'row', alignItems:'center', paddingHorizontal:20, paddingVertical:14, gap:14 },
  sheetOptIcon:   { width:48, height:48, borderRadius:14, justifyContent:'center', alignItems:'center' },
  sheetOptTitle:  { fontSize:15, fontWeight:'600' },
  sheetOptSub:    { fontSize:12, color:'#9CA3AF', marginTop:2 },
  chevron:        { fontSize:22, color:'#D1D5DB' },
  sheetSep:       { height:1, backgroundColor:'#F3F4F6', marginLeft:82 },
  sheetCancel:    { margin:16, backgroundColor:'#F3F4F6', borderRadius:14,
                    paddingVertical:14, alignItems:'center' },
  sheetCancelText:{ fontSize:15, fontWeight:'600', color:'#374151' },

  formBackdrop: { flex:1, backgroundColor:'rgba(0,0,0,0.45)', justifyContent:'flex-end', alignItems:'center' },
  formSheet:    { backgroundColor:'#fff', borderTopLeftRadius:24, borderTopRightRadius:24,
                  width:'100%', maxWidth:600, maxHeight:'80%' },
  formHead:     { flexDirection:'row', justifyContent:'space-between', alignItems:'center',
                  paddingHorizontal:20, paddingVertical:16, borderBottomWidth:1, borderBottomColor:'#F3F4F6' },
  formTitle:    { fontSize:16, fontWeight:'700', color:'#111827' },
  formClose:    { fontSize:14, color:'#3B82F6', fontWeight:'500' },
  formBody:     { padding:20, paddingBottom:36 },
  formLabel:    { fontSize:13, fontWeight:'500', color:'#374151', marginBottom:6, marginTop:14 },
  formInput:    { height:50, backgroundColor:'#F9FAFB', borderWidth:1, borderColor:'#E5E7EB',
                  borderRadius:12, paddingHorizontal:14, justifyContent:'center' },
  formValText:  { color:'#111827', fontSize:15 },
  formPlaceholder:{ color:'#9CA3AF', fontSize:15 },
  formError:    { color:'#DC2626', fontSize:13, marginTop:8, backgroundColor:'#FEF2F2', borderRadius:8, padding:10 },
  formSaveBtn:  { height:50, backgroundColor:'#7C3AED', borderRadius:12,
                  justifyContent:'center', alignItems:'center', marginTop:20 },
  formSaveText: { color:'#fff', fontSize:15, fontWeight:'600' },
  catOpt:       { flexDirection:'row', justifyContent:'space-between', alignItems:'center',
                  paddingHorizontal:20, paddingVertical:14 },
  catOptText:   { fontSize:15, color:'#111827' },
});
