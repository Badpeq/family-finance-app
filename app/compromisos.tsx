import { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, SafeAreaView, Platform, Modal, TextInput,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';

const SYM: Record<string, string> = { PEN: 'S/', USD: '$', EUR: '€', BRL: 'R$', COP: '$', MXN: '$', ARS: '$', CLP: '$' };

interface CompromisoProgramado {
  id: string;
  tipo_programado: 'recurrente' | 'cuota';
  descripcion: string | null;
  categoria: string;
  monto_cuota: number;
  dia_cobro: number;
  aplicado: boolean;
}

interface Cuota {
  id: string;
  total_cuotas: number;
  mes_inicio: string;
  descripcion: string;
}

function cuotaActual(mesInicioStr: string): number {
  const now = new Date();
  const ini = new Date(mesInicioStr + 'T12:00:00');
  return (now.getFullYear() - ini.getFullYear()) * 12 + now.getMonth() - ini.getMonth() + 1;
}

const CAT_ICONS: Record<string, string> = {
  Alimentación: '🛒', Transporte: '🚗', Vivienda: '🏠', Entretenimiento: '🎬',
  Salud: '💊', Educación: '📚', Ropa: '👕', Servicios: '⚡', Restaurantes: '🍽️', Otros: '📦',
};
const iconFor = (cat: string) => CAT_ICONS[cat] ?? '📦';

export default function Compromisos() {
  const [items,          setItems]          = useState<CompromisoProgramado[]>([]);
  const [cuotas,         setCuotas]         = useState<Cuota[]>([]);
  const [currency,       setCurrency]       = useState('PEN');
  const [loading,        setLoading]        = useState(true);

  // Action sheet
  const [actionItem,     setActionItem]     = useState<CompromisoProgramado | null>(null);

  // Edit día de cobro
  const [editItem,       setEditItem]       = useState<CompromisoProgramado | null>(null);
  const [editDia,        setEditDia]        = useState('');
  const [editError,      setEditError]      = useState('');
  const [saving,         setSaving]         = useState(false);

  // Confirmar anulación
  const [confirmAnular,  setConfirmAnular]  = useState<CompromisoProgramado | null>(null);
  const [anulando,       setAnulando]       = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !active) return;

        const [profRes, viewRes, cuotasRes] = await Promise.all([
          supabase.from('profiles').select('moneda_base').eq('id', user.id).single(),
          supabase.from('v_gastos_programados_mes')
            .select('id,tipo_programado,descripcion,categoria,monto_cuota,dia_cobro,aplicado')
            .order('aplicado')
            .order('dia_cobro'),
          supabase.from('compras_cuotas')
            .select('id,total_cuotas,mes_inicio,descripcion')
            .eq('user_id', user.id),
        ]);

        if (!active) return;
        if (profRes.data) setCurrency((profRes.data as any).moneda_base ?? 'PEN');
        setItems((viewRes.data ?? []) as CompromisoProgramado[]);
        setCuotas((cuotasRes.data ?? []) as Cuota[]);
        setLoading(false);
      })();
      return () => { active = false; };
    }, [])
  );

  const sym = SYM[currency] ?? currency;
  const pendientes    = items.filter(i => !i.aplicado);
  const aplicados     = items.filter(i =>  i.aplicado);
  const totalPendiente = pendientes.reduce((s, i) => s + Number(i.monto_cuota), 0);
  const totalAplicado  = aplicados.reduce((s, i)  => s + Number(i.monto_cuota), 0);

  const cuotaInfo = (id: string) => cuotas.find(c => c.id === id);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const openEdit = (item: CompromisoProgramado) => {
    setEditError('');
    setEditItem(item);
    setEditDia(String(item.dia_cobro));
    setActionItem(null);
  };

  const handleEditSave = async () => {
    if (!editItem) return;
    const dia = parseInt(editDia.trim(), 10);
    if (isNaN(dia) || dia < 1 || dia > 31) {
      setEditError('Ingresa un día válido entre 1 y 31.');
      return;
    }
    setSaving(true);
    const table = editItem.tipo_programado === 'recurrente' ? 'gastos_recurrentes' : 'compras_cuotas';
    const { error } = await supabase.from(table).update({ dia_cobro: dia }).eq('id', editItem.id);
    if (error) { setEditError(error.message); setSaving(false); return; }
    setItems(prev => prev.map(i => i.id === editItem!.id ? { ...i, dia_cobro: dia } : i));
    setEditItem(null);
    setSaving(false);
  };

  const handleAnular = async () => {
    if (!confirmAnular) return;
    setAnulando(true);
    const now = new Date();
    // Set mes_fin to PREVIOUS month so v_gastos_programados_mes excludes it immediately
    // (the view uses mes_fin >= current_period, so current_month would still match)
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const mesFin = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-01`;

    if (confirmAnular.tipo_programado === 'recurrente') {
      await supabase.from('gastos_recurrentes').update({ mes_fin: mesFin }).eq('id', confirmAnular.id);
    } else {
      // For cuotas: delete the record
      await supabase.from('compras_cuotas').delete().eq('id', confirmAnular.id);
    }
    setItems(prev => prev.filter(i => i.id !== confirmAnular!.id));
    setConfirmAnular(null);
    setAnulando(false);
  };

  // ── Render item ───────────────────────────────────────────────────────────────

  const renderItem = (item: CompromisoProgramado) => {
    const cuota    = item.tipo_programado === 'cuota' ? cuotaInfo(item.id) : null;
    const cuotaNum = cuota ? cuotaActual(cuota.mes_inicio) : null;
    return (
      <View key={item.id} style={s.card}>
        <View style={s.cardLeft}>
          <Text style={s.cardIcon}>{iconFor(item.categoria)}</Text>
        </View>
        <View style={s.cardBody}>
          <View style={s.cardTitleRow}>
            <Text style={s.cardName} numberOfLines={1}>
              {item.descripcion ?? item.categoria}
            </Text>
            <View style={[s.badge, item.tipo_programado === 'cuota' ? s.badgeCuota : s.badgeRec]}>
              <Text style={[s.badgeText, item.tipo_programado === 'cuota' ? s.badgeCuotaText : s.badgeRecText]}>
                {item.tipo_programado === 'cuota' ? '📅 Cuota' : '🔄 Recurrente'}
              </Text>
            </View>
          </View>
          <Text style={s.cardMeta}>
            {item.categoria}
            {cuota && cuotaNum !== null
              ? ` · Cuota ${cuotaNum} de ${cuota.total_cuotas}`
              : ` · Día ${item.dia_cobro} de cada mes`}
          </Text>
          {cuota && cuotaNum !== null && (
            <View style={s.progressBg}>
              <View style={[s.progressFill, { width: `${Math.min((cuotaNum / cuota.total_cuotas) * 100, 100)}%` as any }]} />
            </View>
          )}
        </View>
        <View style={s.cardRight}>
          <Text style={[s.cardAmt, item.aplicado ? s.amtApplied : s.amtPending]}>
            {sym} {Number(item.monto_cuota).toFixed(2)}
          </Text>
          <TouchableOpacity
            style={s.menuBtn}
            onPress={() => setActionItem(item)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={s.menuBtnText}>···</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>‹ Volver</Text>
        </TouchableOpacity>
        <Text style={s.title}>Compromisos Fijos</Text>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <ActivityIndicator color="#7C3AED" style={{ marginTop: 48 }} />
      ) : (
        <ScrollView contentContainerStyle={s.scroll}>

          {/* Resumen */}
          <View style={s.summary}>
            <View style={s.summaryItem}>
              <Text style={s.summaryLabel}>Pendientes</Text>
              <Text style={[s.summaryAmt, { color: '#DC2626' }]}>{sym} {totalPendiente.toFixed(2)}</Text>
              <Text style={s.summaryCount}>{pendientes.length} compromiso{pendientes.length !== 1 ? 's' : ''}</Text>
            </View>
            <View style={s.summaryDiv} />
            <View style={s.summaryItem}>
              <Text style={s.summaryLabel}>Aplicados</Text>
              <Text style={[s.summaryAmt, { color: '#059669' }]}>{sym} {totalAplicado.toFixed(2)}</Text>
              <Text style={s.summaryCount}>{aplicados.length} compromiso{aplicados.length !== 1 ? 's' : ''}</Text>
            </View>
          </View>

          {items.length === 0 && (
            <View style={s.empty}>
              <Text style={s.emptyIcon}>🔄</Text>
              <Text style={s.emptyTitle}>Sin compromisos fijos este mes</Text>
              <Text style={s.emptySub}>
                Registra gastos recurrentes o cuotas desde Gestionar Deudas.
              </Text>
            </View>
          )}

          {pendientes.length > 0 && (
            <>
              <Text style={s.sectionLabel}>PENDIENTES — {sym} {totalPendiente.toFixed(2)}</Text>
              {pendientes.map(renderItem)}
            </>
          )}

          {aplicados.length > 0 && (
            <>
              <Text style={[s.sectionLabel, { marginTop: 20 }]}>APLICADOS ESTE MES ✓</Text>
              {aplicados.map(renderItem)}
            </>
          )}

          <View style={{ height: 48 }} />
        </ScrollView>
      )}

      {/* ── Action sheet ── */}
      <Modal visible={!!actionItem} animationType="slide" transparent>
        <TouchableOpacity
          style={s.overlay}
          activeOpacity={1}
          onPress={() => setActionItem(null)}
        >
          <View style={s.sheet}>
            <View style={s.sheetPill} />
            <Text style={s.sheetTitle} numberOfLines={1}>
              {actionItem?.descripcion ?? actionItem?.categoria ?? ''}
            </Text>
            <View style={s.sheetSep} />

            <TouchableOpacity style={s.sheetOpt} onPress={() => openEdit(actionItem!)}>
              <View style={[s.optIcon, { backgroundColor: '#EFF6FF' }]}>
                <Text style={{ fontSize: 18 }}>📅</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.optTitle}>Cambiar día de cobro</Text>
                <Text style={s.optSub}>Actualmente: día {actionItem?.dia_cobro} de cada mes</Text>
              </View>
            </TouchableOpacity>

            <View style={s.sheetSep} />
            <TouchableOpacity
              style={s.sheetOpt}
              onPress={() => { setConfirmAnular(actionItem!); setActionItem(null); }}
            >
              <View style={[s.optIcon, { backgroundColor: '#FEF2F2' }]}>
                <Text style={{ fontSize: 18 }}>🚫</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.optTitle, { color: '#DC2626' }]}>
                  {actionItem?.tipo_programado === 'recurrente' ? 'Anular recurrente' : 'Eliminar cuota'}
                </Text>
                <Text style={s.optSub}>
                  {actionItem?.tipo_programado === 'recurrente'
                    ? 'No aparecerá a partir del mes siguiente'
                    : 'Se eliminarán todas las cuotas pendientes'}
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={s.sheetCancel} onPress={() => setActionItem(null)}>
              <Text style={s.sheetCancelText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Edit día de cobro ── */}
      <Modal visible={!!editItem} animationType="slide" transparent>
        <View style={s.overlay}>
          <View style={s.editSheet}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle}>Cambiar día de cobro</Text>
              <TouchableOpacity onPress={() => setEditItem(null)}>
                <Text style={s.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={s.editSub}>
              {editItem?.descripcion ?? editItem?.categoria}
            </Text>
            <Text style={s.editLabel}>Día del mes (1 – 31)</Text>
            <TextInput
              style={s.editInput}
              value={editDia}
              onChangeText={t => setEditDia(t.replace(/\D/g, '').slice(0, 2))}
              keyboardType="number-pad"
              maxLength={2}
              placeholder="Ej: 15"
              placeholderTextColor="#9CA3AF"
            />
            {!!editError && (
              <Text style={s.editError}>{editError}</Text>
            )}
            <View style={s.editBtns}>
              <TouchableOpacity style={s.editCancel} onPress={() => setEditItem(null)}>
                <Text style={s.editCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.editSave, saving && { opacity: 0.6 }]}
                onPress={handleEditSave}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.editSaveText}>Guardar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Confirm anular ── */}
      <Modal visible={!!confirmAnular} animationType="fade" transparent>
        <View style={s.confirmBg}>
          <View style={s.confirmBox}>
            <Text style={s.confirmTitle}>
              {confirmAnular?.tipo_programado === 'recurrente' ? '¿Anular recurrente?' : '¿Eliminar cuota?'}
            </Text>
            <Text style={s.confirmSub}>
              {confirmAnular?.tipo_programado === 'recurrente'
                ? `"${confirmAnular?.descripcion ?? confirmAnular?.categoria}" no aparecerá a partir del mes siguiente. El historial de pagos se conserva.`
                : `Se eliminarán todas las cuotas pendientes de "${confirmAnular?.descripcion}". Esta acción no se puede deshacer.`}
            </Text>
            <View style={s.confirmBtns}>
              <TouchableOpacity style={s.confirmCancel} onPress={() => setConfirmAnular(null)}>
                <Text style={s.confirmCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.confirmDanger, anulando && { opacity: 0.6 }]}
                onPress={handleAnular}
                disabled={anulando}
              >
                {anulando
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.confirmDangerText}>
                      {confirmAnular?.tipo_programado === 'recurrente' ? 'Anular' : 'Eliminar'}
                    </Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#F9FAFB' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'android' ? 44 : 12, paddingHorizontal: 20, paddingBottom: 14,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  backBtn:  { width: 60 },
  backText: { fontSize: 16, color: '#3B82F6', fontWeight: '500' },
  title:    { fontSize: 18, fontWeight: '700', color: '#111827' },

  scroll: { padding: 16 },

  summary:     { backgroundColor: '#fff', borderRadius: 16, padding: 20, flexDirection: 'row', marginBottom: 20, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryLabel:{ fontSize: 11, color: '#9CA3AF', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  summaryAmt:  { fontSize: 20, fontWeight: '800', marginBottom: 2 },
  summaryCount:{ fontSize: 11, color: '#9CA3AF' },
  summaryDiv:  { width: 1, backgroundColor: '#F3F4F6', marginHorizontal: 10 },

  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 },

  card:      { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  cardLeft:  { width: 40, height: 40, borderRadius: 10, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center', marginRight: 12, flexShrink: 0 },
  cardIcon:  { fontSize: 20 },
  cardBody:  { flex: 1, minWidth: 0 },
  cardTitleRow:{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' },
  cardName:  { fontSize: 14, fontWeight: '600', color: '#111827', flexShrink: 1 },
  cardMeta:  { fontSize: 11, color: '#9CA3AF', marginBottom: 4 },
  cardRight: { alignItems: 'flex-end', marginLeft: 8, flexShrink: 0 },
  cardAmt:   { fontSize: 15, fontWeight: '700', marginBottom: 6 },
  menuBtn:   { backgroundColor: '#F3F4F6', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  menuBtnText:{ fontSize: 14, color: '#374151', fontWeight: '700', letterSpacing: 2 },
  amtPending:{ color: '#DC2626' },
  amtApplied:{ color: '#059669' },

  progressBg:   { height: 4, backgroundColor: '#F3F4F6', borderRadius: 2, overflow: 'hidden', marginTop: 2 },
  progressFill: { height: '100%' as any, backgroundColor: '#7C3AED', borderRadius: 2 },

  badge:         { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeRec:      { backgroundColor: '#D1FAE5' },
  badgeRecText:  { color: '#065F46' },
  badgeCuota:    { backgroundColor: '#DBEAFE' },
  badgeCuotaText:{ color: '#1E40AF' },
  badgeText:     { fontSize: 10, fontWeight: '700' },

  empty:      { alignItems: 'center', paddingTop: 48, paddingHorizontal: 32 },
  emptyIcon:  { fontSize: 48, marginBottom: 14 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#374151', marginBottom: 8, textAlign: 'center' },
  emptySub:   { fontSize: 13, color: '#9CA3AF', textAlign: 'center', lineHeight: 20 },

  // Action sheet
  overlay:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet:         { backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: Platform.OS === 'ios' ? 36 : 16 },
  sheetPill:     { width: 36, height: 4, backgroundColor: '#E5E7EB', borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 6 },
  sheetTitle:    { fontSize: 13, fontWeight: '600', color: '#6B7280', paddingHorizontal: 20, paddingVertical: 10 },
  sheetSep:      { height: 1, backgroundColor: '#F3F4F6' },
  sheetOpt:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 14 },
  optIcon:       { width: 42, height: 42, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  optTitle:      { fontSize: 15, fontWeight: '500', color: '#111827' },
  optSub:        { fontSize: 12, color: '#9CA3AF', marginTop: 1 },
  sheetCancel:   { margin: 14, marginTop: 8, backgroundColor: '#F3F4F6', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  sheetCancelText: { fontSize: 15, fontWeight: '600', color: '#374151' },

  // Edit modal
  editSheet:     { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, width: '100%' },
  sheetHead:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  closeBtn:      { fontSize: 18, color: '#9CA3AF', padding: 4 },
  editSub:       { fontSize: 13, color: '#6B7280', marginBottom: 20 },
  editLabel:     { fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 8 },
  editInput:     { height: 52, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, paddingHorizontal: 16, fontSize: 24, fontWeight: '700', color: '#111827', marginBottom: 8, textAlign: 'center' },
  editError:     { fontSize: 13, color: '#DC2626', marginBottom: 12 },
  editBtns:      { flexDirection: 'row', gap: 10, marginTop: 8 },
  editCancel:    { flex: 1, height: 48, backgroundColor: '#F3F4F6', borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  editCancelText:{ fontSize: 15, color: '#374151', fontWeight: '500' },
  editSave:      { flex: 1, height: 48, backgroundColor: '#3B82F6', borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  editSaveText:  { fontSize: 15, color: '#fff', fontWeight: '600' },

  // Confirm dialog
  confirmBg:         { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  confirmBox:        { backgroundColor: '#fff', borderRadius: 20, padding: 24, width: '100%', maxWidth: 360 },
  confirmTitle:      { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 10 },
  confirmSub:        { fontSize: 13, color: '#6B7280', lineHeight: 20, marginBottom: 20 },
  confirmBtns:       { flexDirection: 'row', gap: 10 },
  confirmCancel:     { flex: 1, height: 46, backgroundColor: '#F3F4F6', borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  confirmCancelText: { fontSize: 14, color: '#374151', fontWeight: '500' },
  confirmDanger:     { flex: 1, height: 46, backgroundColor: '#DC2626', borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  confirmDangerText: { fontSize: 14, color: '#fff', fontWeight: '600' },
});
