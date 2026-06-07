import { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Platform, ActivityIndicator, Modal, TextInput,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';

interface Profile      { nombre: string; moneda_base: string; }
interface Transaccion  { id: string; tipo: 'ingreso' | 'gasto'; monto: number; categoria: string; descripcion: string | null; metodo_pago: string | null; creado_en: string; }
interface CuentaAhorro { id: string; nombre_cuenta: string; saldo_actual: number; }
interface Tarjeta      { id: string; banco: string; nombre_tarjeta: string; deuda_actual: number; linea_credito: number; }
interface Prestamo     { id: string; entidad_persona: string; tipo: 'recibido' | 'otorgado'; saldo_pendiente: number; cuotas_estimadas: number | null; cuotas_pagadas: number; }

const ICON: Record<string, string> = {
  Sueldo: '💼', Freelance: '💻', Inversiones: '📈', Negocio: '🏪',
  Ahorro: '🏦', 'Retiro Ahorro': '💰', 'Pago Tarjeta': '💳', 'Abono Préstamo': '📋',
  Alimentación: '🛒', Transporte: '🚗', Vivienda: '🏠', Entretenimiento: '🎬',
  Salud: '💊', Educación: '📚', Ropa: '👕', Servicios: '⚡', Otros: '📦',
};

const MONTHS = ['enero','febrero','marzo','abril','mayo','junio',
                'julio','agosto','septiembre','octubre','noviembre','diciembre'];

const SYM: Record<string, string> = {
  PEN: 'S/', USD: '$', EUR: '€', BRL: 'R$', COP: '$', MXN: '$', ARS: '$', CLP: '$',
};

function fmt(amount: number, currency: string) {
  const symbol = SYM[currency] ?? currency;
  return `${symbol} ${amount.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getGreeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}

export default function Dashboard() {
  const [profile,       setProfile]       = useState<Profile | null>(null);
  const [transacciones, setTransacciones] = useState<Transaccion[]>([]);
  const [cuentas,       setCuentas]       = useState<CuentaAhorro[]>([]);
  const [tarjetas,      setTarjetas]      = useState<Tarjeta[]>([]);
  const [prestamos,     setPrestamos]     = useState<Prestamo[]>([]);
  const [loading,       setLoading]       = useState(true);

  // Edit tarjeta
  const [editTarjeta,      setEditTarjeta]      = useState<Tarjeta | null>(null);
  const [editDeudaVal,     setEditDeudaVal]     = useState('');
  const [editLineaVal,     setEditLineaVal]     = useState('');
  const [editTarjetaError, setEditTarjetaError] = useState('');
  const [editTarjetaSaving,setEditTarjetaSaving]= useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !active) return;

        const now          = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        const [profileRes, txRes, cuentasRes, tarjetasRes, prestamosRes] =
          await Promise.all([
            supabase
              .from('profiles')
              .select('nombre, moneda_base')
              .eq('id', user.id)
              .single(),
            supabase
              .from('transacciones')
              .select('id, tipo, monto, categoria, descripcion, metodo_pago, creado_en')
              .eq('user_id', user.id)
              .eq('activo', true)
              .gte('creado_en', startOfMonth)
              .order('creado_en', { ascending: false })
              .limit(50),
            supabase
              .from('cuentas_ahorro')
              .select('id, nombre_cuenta, saldo_actual')
              .eq('user_id', user.id)
              .order('creado_en', { ascending: true }),
            supabase
              .from('tarjetas_credito')
              .select('id, banco, nombre_tarjeta, deuda_actual, linea_credito')
              .eq('user_id', user.id)
              .order('creado_en', { ascending: true }),
            supabase
              .from('prestamos')
              .select('id, entidad_persona, tipo, saldo_pendiente, cuotas_estimadas, cuotas_pagadas')
              .eq('user_id', user.id)
              .gt('saldo_pendiente', 0)
              .order('creado_en', { ascending: true }),
          ]);

        if (!active) return;
        if (profileRes.data)   setProfile(profileRes.data as Profile);
        if (txRes.data)        setTransacciones(txRes.data as Transaccion[]);
        if (cuentasRes.data)   setCuentas(cuentasRes.data as CuentaAhorro[]);
        if (tarjetasRes.data)  setTarjetas(tarjetasRes.data as Tarjeta[]);
        if (prestamosRes.data) setPrestamos(prestamosRes.data as Prestamo[]);
        setLoading(false);
      })();
      return () => { active = false; };
    }, [])
  );

  const currency   = profile?.moneda_base ?? 'PEN';
  const initial    = profile?.nombre?.charAt(0).toUpperCase() ?? '?';
  const now        = new Date();
  const monthLabel = `${MONTHS[now.getMonth()]} ${now.getFullYear()}`;

  const income   = transacciones.filter(t => t.tipo === 'ingreso').reduce((s, t) => s + Number(t.monto), 0);
  const expenses = transacciones.filter(t => t.tipo === 'gasto').reduce((s, t)  => s + Number(t.monto), 0);

  // Balance unificado: todos los flujos de cash pasan por transacciones (via triggers)
  const balance      = income - expenses;
  const totalAhorros = cuentas.reduce((s, c)  => s + Number(c.saldo_actual), 0);
  const totalTarjeta = tarjetas.reduce((s, t) => s + Number(t.deuda_actual), 0);
  const totalPrestamo = prestamos.reduce((s, p) => s + Number(p.saldo_pendiente), 0);
  const hayDeudas    = totalTarjeta > 0 || totalPrestamo > 0 || tarjetas.length > 0 || prestamos.length > 0;

  const recent = transacciones.slice(0, 5);

  const openEditTarjeta = (t: Tarjeta) => {
    setEditTarjeta(t);
    setEditDeudaVal(String(Number(t.deuda_actual)));
    setEditLineaVal(String(Number(t.linea_credito)));
    setEditTarjetaError('');
  };

  const handleSaveTarjeta = async () => {
    const deuda = parseFloat(editDeudaVal.replace(',', '.'));
    const linea = parseFloat(editLineaVal.replace(',', '.'));
    if (isNaN(deuda) || deuda < 0) { setEditTarjetaError('Deuda inválida.'); return; }
    if (isNaN(linea) || linea < 0) { setEditTarjetaError('Línea de crédito inválida.'); return; }
    setEditTarjetaError('');
    setEditTarjetaSaving(true);

    await supabase.from('tarjetas_credito').update({
      deuda_actual: deuda,
      linea_credito: linea,
    }).eq('id', editTarjeta!.id);

    setTarjetas(prev => prev.map(t =>
      t.id === editTarjeta!.id
        ? { ...t, deuda_actual: deuda, linea_credito: linea }
        : t
    ));
    setEditTarjeta(null);
    setEditTarjetaSaving(false);
  };

  return (
    <View style={{ flex: 1 }}>
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.wrapper}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={{ flexShrink: 1, minWidth: 0, marginRight: 12 }}>
            {loading && !profile
              ? <ActivityIndicator color="#3B82F6" />
              : <>
                  <Text style={styles.greeting} numberOfLines={1}>
                    {getGreeting()}, {profile?.nombre ?? ''} 👋
                  </Text>
                  <Text style={styles.period}>Resumen · {monthLabel}</Text>
                </>
            }
          </View>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
        </View>

        {/* ── Balance Card ── */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Balance Disponible</Text>
          <Text style={styles.cardBalance}>
            {loading ? '—' : fmt(balance, currency)}
          </Text>
          <View style={styles.cardDivider} />
          <View style={styles.cardRow}>
            <View style={styles.cardStat}>
              <View style={[styles.statBadge, styles.incomeBadge]}>
                <Text style={styles.statBadgeText}>↑</Text>
              </View>
              <View style={{ minWidth: 0, flexShrink: 1 }}>
                <Text style={styles.statLabel}>Ingresos</Text>
                <Text style={[styles.statAmount, styles.incomeText]}>
                  {loading ? '—' : fmt(income, currency)}
                </Text>
              </View>
            </View>
            <View style={styles.cardVertDivider} />
            <View style={styles.cardStat}>
              <View style={[styles.statBadge, styles.expenseBadge]}>
                <Text style={styles.statBadgeText}>↓</Text>
              </View>
              <View style={{ minWidth: 0, flexShrink: 1 }}>
                <Text style={styles.statLabel}>Gastos</Text>
                <Text style={[styles.statAmount, styles.expenseText]}>
                  {loading ? '—' : fmt(expenses, currency)}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* ── Savings Card ── */}
        {(cuentas.length > 0 || loading) && (
          <View style={styles.ahorrosCard}>
            <View style={styles.ahorrosHeader}>
              <Text style={styles.ahorrosTitle}>🏦 Ahorros & Inversiones</Text>
              <Text style={styles.ahorrosTotal}>
                {loading ? '—' : fmt(totalAhorros, currency)}
              </Text>
            </View>
            {!loading && cuentas.length > 0 && (
              <>
                <View style={styles.cardDividerLight} />
                {cuentas.map(c => (
                  <View key={c.id} style={styles.cuentaRow}>
                    <Text style={styles.cuentaNombre} numberOfLines={1}>{c.nombre_cuenta}</Text>
                    <Text style={styles.cuentaSaldo}>{fmt(Number(c.saldo_actual), currency)}</Text>
                  </View>
                ))}
              </>
            )}
          </View>
        )}

        {/* ── Debt Summary Card ── */}
        {!loading && hayDeudas && (
          <View style={styles.deudasCard}>
            <View style={styles.deudasHeader}>
              <Text style={styles.deudasTitle}>⚠️ Deudas</Text>
              <Text style={styles.deudasTotal}>
                {fmt(totalTarjeta + totalPrestamo, currency)}
              </Text>
            </View>

            {/* Tarjetas */}
            {tarjetas.length > 0 && (
              <>
                <View style={styles.cardDividerLight} />
                <Text style={styles.deudasSection}>💳 Tarjetas de Crédito</Text>
                {tarjetas.map(t => (
                  <View key={t.id} style={styles.deudasRow}>
                    <Text style={styles.deudasNombre} numberOfLines={1}>
                      {t.banco} · {t.nombre_tarjeta}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Text style={[
                        styles.deudasMonto,
                        Number(t.deuda_actual) > 0 ? styles.redText : styles.grayText,
                      ]}>
                        {fmt(Number(t.deuda_actual), currency)}
                      </Text>
                      <TouchableOpacity onPress={() => openEditTarjeta(t)}>
                        <Text style={styles.tarjetaEditBtn}>✎</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </>
            )}

            {/* Préstamos */}
            {prestamos.length > 0 && (
              <>
                <View style={styles.cardDividerLight} />
                <Text style={styles.deudasSection}>📋 Préstamos Activos</Text>
                {prestamos.map(p => {
                  const cuotasPend = p.cuotas_estimadas != null
                    ? Math.max(0, p.cuotas_estimadas - p.cuotas_pagadas)
                    : null;
                  return (
                    <View key={p.id} style={styles.deudasRowPrestamo}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.deudasNombre} numberOfLines={1}>
                          {p.entidad_persona}
                        </Text>
                        {cuotasPend !== null && (
                          <Text style={styles.cuotasHint}>
                            {cuotasPend} cuota{cuotasPend !== 1 ? 's' : ''} pendiente{cuotasPend !== 1 ? 's' : ''}
                          </Text>
                        )}
                      </View>
                      <Text style={styles.deudasMonto}>
                        {fmt(Number(p.saldo_pendiente), currency)}
                      </Text>
                    </View>
                  );
                })}
              </>
            )}

            <TouchableOpacity
              style={styles.deudasPagarBtn}
              onPress={() => router.push(`/pagos?moneda=${currency}`)}
            >
              <Text style={styles.deudasPagarText}>Registrar Pago →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Quick Actions ── */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.incomeBtn]} activeOpacity={0.8}
            onPress={() => router.push(`/registrar?tipo=ingreso&moneda=${currency}`)}
          >
            <Text style={styles.actionIcon}>＋</Text>
            <Text style={styles.actionText}>Ingreso</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.expenseBtn]} activeOpacity={0.8}
            onPress={() => router.push(`/registrar?tipo=gasto&moneda=${currency}`)}
          >
            <Text style={styles.actionIcon}>－</Text>
            <Text style={styles.actionText}>Gasto</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.ahorroBtn]} activeOpacity={0.8}
            onPress={() => router.push(`/ahorros?moneda=${currency}`)}
          >
            <Text style={styles.actionIcon}>🏦</Text>
            <Text style={styles.actionText}>Ahorros</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.pagarBtn]} activeOpacity={0.8}
            onPress={() => router.push(`/pagos?moneda=${currency}`)}
          >
            <Text style={styles.actionIcon}>💳</Text>
            <Text style={styles.actionText}>Pagar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.prestamosBtn]} activeOpacity={0.8}
            onPress={() => router.push(`/prestamos?moneda=${currency}`)}
          >
            <Text style={styles.actionIcon}>📋</Text>
            <Text style={styles.actionText}>Préstamos</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.historialBtn]} activeOpacity={0.8}
            onPress={() => router.push('/historial')}
          >
            <Text style={styles.actionIcon}>📜</Text>
            <Text style={styles.actionText}>Historial</Text>
          </TouchableOpacity>
        </View>

        {/* ── Transactions ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Últimas Transacciones</Text>
          {loading ? (
            <ActivityIndicator color="#3B82F6" style={{ marginTop: 24 }} />
          ) : recent.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>💸</Text>
              <Text style={styles.emptyTitle}>Sin movimientos este mes</Text>
              <Text style={styles.emptySubtitle}>
                Registra tu primer ingreso o gasto usando los botones de arriba.
              </Text>
            </View>
          ) : (
            <View style={styles.txCard}>
              {recent.map((tx, idx) => (
                <View key={tx.id}>
                  <View style={styles.txRow}>
                    <View style={styles.txIconWrap}>
                      <Text style={styles.txIcon}>{ICON[tx.categoria] ?? '📦'}</Text>
                    </View>
                    <View style={styles.txInfo}>
                      <Text style={styles.txDesc} numberOfLines={1}>
                        {tx.descripcion || tx.categoria}
                      </Text>
                      <Text style={styles.txMeta}>
                        {tx.categoria}
                        {' · '}
                        {new Date(tx.creado_en).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' })}
                        {tx.metodo_pago === 'tarjeta' ? ' · 💳' : ''}
                      </Text>
                    </View>
                    <Text style={[styles.txAmount, tx.tipo === 'ingreso' ? styles.incomeText : styles.expenseText]}>
                      {tx.tipo === 'ingreso' ? '+' : '−'}{fmt(Number(tx.monto), currency)}
                    </Text>
                  </View>
                  {idx < recent.length - 1 && <View style={styles.txSep} />}
                </View>
              ))}
              <TouchableOpacity
                style={styles.verHistorialBtn}
                onPress={() => router.push('/historial')}
              >
                <Text style={styles.verHistorialText}>Ver historial completo →</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.bottomSpacer} />
      </View>
    </ScrollView>

    {/* ── Edit tarjeta modal ──*/}
    <Modal visible={!!editTarjeta} animationType="slide" transparent>
      <View style={styles.editBackdrop}>
        <View style={styles.editSheet}>
          <Text style={styles.editSheetTitle}>
            Ajustar: {editTarjeta?.banco} · {editTarjeta?.nombre_tarjeta}
          </Text>

          <Text style={styles.editFieldLabel}>Deuda Vigente</Text>
          <TextInput
            style={styles.editInput}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor="#9CA3AF"
            value={editDeudaVal}
            onChangeText={setEditDeudaVal}
          />

          <Text style={styles.editFieldLabel}>Línea de Crédito</Text>
          <TextInput
            style={styles.editInput}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor="#9CA3AF"
            value={editLineaVal}
            onChangeText={setEditLineaVal}
          />

          {(() => {
            const d = parseFloat(editDeudaVal) || 0;
            const l = parseFloat(editLineaVal) || 0;
            if (l <= 0) return null;
            return (
              <View style={styles.editDisponibleRow}>
                <Text style={styles.editDisponibleLabel}>Disponible</Text>
                <Text style={styles.editDisponibleVal}>
                  {fmt(Math.max(0, l - d), currency)}
                </Text>
              </View>
            );
          })()}

          {!!editTarjetaError && (
            <Text style={styles.editError}>{editTarjetaError}</Text>
          )}

          <View style={styles.editBtns}>
            <TouchableOpacity
              style={[styles.editCancelBtn]}
              onPress={() => setEditTarjeta(null)}
            >
              <Text style={styles.editCancelText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.editSaveBtn, editTarjetaSaving && styles.editBtnDisabled]}
              onPress={handleSaveTarjeta}
              disabled={editTarjetaSaving}
            >
              {editTarjetaSaving
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.editSaveText}>Guardar</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
    </View>
  );
}

const isWeb = Platform.OS === 'web';

const styles = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: '#F3F4F6' },
  content:  { flexGrow: 1, alignItems: 'center', paddingTop: isWeb ? 32 : 56, paddingBottom: 32, paddingHorizontal: 20 },
  wrapper:  { width: '100%', maxWidth: 600 },

  header:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  greeting:   { fontSize: 20, fontWeight: '700', color: '#111827' },
  period:     { fontSize: 13, color: '#9CA3AF', marginTop: 2 },
  avatar:     { width: 44, height: 44, borderRadius: 22, backgroundColor: '#3B82F6', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  avatarText: { color: '#fff', fontSize: 18, fontWeight: '700' },

  card: {
    backgroundColor: '#1B3A6B', borderRadius: 20, padding: 24, marginBottom: 16,
    shadowColor: '#1B3A6B', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: 8,
  },
  cardLabel:    { fontSize: 13, color: 'rgba(255,255,255,0.65)', fontWeight: '500', letterSpacing: 0.5, textTransform: 'uppercase' },
  cardBalance:  { fontSize: 36, fontWeight: '800', color: '#fff', marginTop: 6, marginBottom: 20, letterSpacing: -0.5 },
  cardDivider:  { height: 1, backgroundColor: 'rgba(255,255,255,0.15)', marginBottom: 16 },
  cardRow:      { flexDirection: 'row', alignItems: 'center' },
  cardStat:     { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  cardVertDivider: { width: 1, height: 36, backgroundColor: 'rgba(255,255,255,0.15)', marginHorizontal: 16, flexShrink: 0 },
  statBadge:    { width: 32, height: 32, borderRadius: 10, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  incomeBadge:  { backgroundColor: 'rgba(16,185,129,0.25)' },
  expenseBadge: { backgroundColor: 'rgba(239,68,68,0.25)' },
  statBadgeText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  statLabel:    { fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 2 },
  statAmount:   { fontSize: 15, fontWeight: '700' },
  ahorroMesHint: { fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 12 },

  // Savings card
  ahorrosCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 20, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
    borderLeftWidth: 4, borderLeftColor: '#0891B2',
  },
  ahorrosHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ahorrosTitle:  { fontSize: 15, fontWeight: '700', color: '#0C4A6E' },
  ahorrosTotal:  { fontSize: 17, fontWeight: '800', color: '#0891B2' },
  cardDividerLight: { height: 1, backgroundColor: '#F3F4F6', marginVertical: 12 },
  cuentaRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, minWidth: 0 },
  cuentaNombre: { fontSize: 14, color: '#374151', flex: 1, minWidth: 0, marginRight: 8 },
  cuentaSaldo:  { fontSize: 14, fontWeight: '700', color: '#0891B2', flexShrink: 0 },

  // Debt card
  deudasCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 20, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
    borderLeftWidth: 4, borderLeftColor: '#EF4444',
  },
  deudasHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  deudasTitle:   { fontSize: 15, fontWeight: '700', color: '#7F1D1D' },
  deudasTotal:   { fontSize: 17, fontWeight: '800', color: '#DC2626' },
  deudasSection: { fontSize: 12, fontWeight: '600', color: '#6B7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  deudasRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5, minWidth: 0 },
  deudasRowPrestamo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 5, minWidth: 0 },
  deudasNombre:  { fontSize: 14, color: '#374151', flex: 1, minWidth: 0, marginRight: 8 },
  cuotasHint:    { fontSize: 11, color: '#9CA3AF', marginTop: 2 },
  deudasMonto:   { fontSize: 14, fontWeight: '700', color: '#DC2626', flexShrink: 0 },
  deudasPagarBtn: { marginTop: 14, alignSelf: 'flex-end' },
  deudasPagarText: { fontSize: 13, color: '#3B82F6', fontWeight: '600' },

  // Actions
  actions:    { flexDirection: 'row', gap: 10, marginBottom: 10 },
  actionBtn:  { flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 14, borderRadius: 14 },
  incomeBtn:  { backgroundColor: '#D1FAE5' },
  expenseBtn: { backgroundColor: '#FEE2E2' },
  ahorroBtn:  { backgroundColor: '#E0F2FE' },
  pagarBtn:   { backgroundColor: '#FEF3C7' },
  prestamosBtn: { backgroundColor: '#F3E8FF' },
  historialBtn: { backgroundColor: '#F3F4F6' },
  actionIcon: { fontSize: 20 },
  actionText: { fontSize: 13, fontWeight: '600', color: '#111827' },

  section:      { marginBottom: 8, marginTop: 18 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#111827', marginBottom: 12 },

  txCard: {
    backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  txRow:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  txIconWrap: { width: 42, height: 42, borderRadius: 12, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center', marginRight: 12, flexShrink: 0 },
  txIcon:    { fontSize: 20 },
  txInfo:    { flex: 1, minWidth: 0 },
  txDesc:    { fontSize: 15, fontWeight: '600', color: '#111827' },
  txMeta:    { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  txAmount:  { fontSize: 15, fontWeight: '700', flexShrink: 0, marginLeft: 8 },
  txSep:     { height: 1, backgroundColor: '#F3F4F6', marginLeft: 70 },

  verHistorialBtn: {
    paddingVertical: 14, alignItems: 'center',
    borderTopWidth: 1, borderTopColor: '#F3F4F6',
  },
  verHistorialText: { fontSize: 13, color: '#3B82F6', fontWeight: '500' },

  emptyState:    { backgroundColor: '#fff', borderRadius: 16, padding: 32, alignItems: 'center' },
  emptyIcon:     { fontSize: 40, marginBottom: 12 },
  emptyTitle:    { fontSize: 16, fontWeight: '600', color: '#111827', marginBottom: 6 },
  emptySubtitle: { fontSize: 14, color: '#9CA3AF', textAlign: 'center', lineHeight: 20 },

  incomeText:   { color: '#059669' },
  expenseText:  { color: '#DC2626' },
  redText:      { color: '#DC2626' },
  grayText:     { color: '#9CA3AF' },
  bottomSpacer: { height: 32 },

  tarjetaEditBtn: { fontSize: 16, color: '#9CA3AF' },

  // Edit tarjeta modal
  editBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end', alignItems: 'center',
  },
  editSheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    width: '100%', maxWidth: 600, padding: 24, paddingBottom: 40,
  },
  editSheetTitle:  { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 20 },
  editFieldLabel:  { fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 },
  editInput: {
    height: 50, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: 12, paddingHorizontal: 16, fontSize: 16, color: '#111827', marginBottom: 14,
  },
  editDisponibleRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#F0FDF4', borderRadius: 10, padding: 12, marginBottom: 14,
  },
  editDisponibleLabel: { fontSize: 13, color: '#374151' },
  editDisponibleVal:   { fontSize: 14, fontWeight: '700', color: '#059669' },
  editError:  { color: '#DC2626', fontSize: 13, marginBottom: 12 },
  editBtns:   { flexDirection: 'row', gap: 10, marginTop: 4 },
  editCancelBtn: {
    flex: 1, height: 48, backgroundColor: '#F3F4F6', borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
  },
  editCancelText: { fontSize: 15, color: '#374151', fontWeight: '500' },
  editSaveBtn: {
    flex: 1, height: 48, backgroundColor: '#3B82F6', borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
  },
  editSaveText:    { color: '#fff', fontSize: 15, fontWeight: '600' },
  editBtnDisabled: { opacity: 0.6 },
});
