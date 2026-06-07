import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Platform, ActivityIndicator, Modal, TextInput,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';

interface Tx {
  id: string;
  tipo: 'ingreso' | 'gasto';
  monto: number;
  categoria: string;
  descripcion: string | null;
  metodo_pago: 'efectivo' | 'tarjeta' | null;
  tarjeta_id: string | null;
  prestamo_id: string | null;
  cuenta_ahorro_id: string | null;
  activo: boolean;
  creado_en: string;
}

const PAGE = 30;

const ICON: Record<string, string> = {
  Sueldo: '💼', Freelance: '💻', Inversiones: '📈', Negocio: '🏪',
  Ahorro: '🏦', 'Retiro Ahorro': '💰', 'Pago Tarjeta': '💳', 'Abono Préstamo': '📋',
  Alimentación: '🛒', Transporte: '🚗', Vivienda: '🏠', Entretenimiento: '🎬',
  Salud: '💊', Educación: '📚', Ropa: '👕', Servicios: '⚡', Otros: '📦',
};

const GASTO_CATS  = ['Alimentación','Transporte','Vivienda','Entretenimiento','Salud','Educación','Ropa','Servicios','Otros'];
const INGRESO_CATS = ['Sueldo','Freelance','Inversiones','Negocio','Otros'];

const SYM: Record<string, string> = { PEN:'S/', USD:'$', EUR:'€', BRL:'R$', COP:'$', MXN:'$', ARS:'$', CLP:'$' };

export default function Historial() {
  const [txs,         setTxs]         = useState<Tx[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [currency,    setCurrency]    = useState('PEN');
  const [showInactive,setShowInactive]= useState(false);
  const [page,        setPage]        = useState(0);
  const [hasMore,     setHasMore]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Edit modal
  const [editing,       setEditing]       = useState<Tx | null>(null);
  const [editMonto,     setEditMonto]     = useState('');
  const [editCat,       setEditCat]       = useState('');
  const [editDesc,      setEditDesc]      = useState('');
  const [showCatPicker, setShowCatPicker] = useState(false);
  const [saving,        setSaving]        = useState(false);

  // Deactivate confirm
  const [confirmTx,    setConfirmTx]    = useState<Tx | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      (async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !mounted) return;
        const { data } = await supabase.from('profiles').select('moneda_base').eq('id', user.id).single();
        if (mounted && data) setCurrency(data.moneda_base);
      })();
      setPage(0);
      setShowInactive(false);
      fetchTxs(0, false, true);
      return () => { mounted = false; };
    }, [])
  );

  const fmt = (n: number) => {
    const s = SYM[currency] ?? currency;
    return `${s} ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  async function fetchTxs(pageNum: number, inactive: boolean, reset: boolean) {
    if (reset) setLoading(true); else setLoadingMore(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); setLoadingMore(false); return; }

    let q = supabase
      .from('transacciones')
      .select('id, tipo, monto, categoria, descripcion, metodo_pago, tarjeta_id, prestamo_id, cuenta_ahorro_id, activo, creado_en')
      .eq('user_id', user.id)
      .order('creado_en', { ascending: false })
      .range(pageNum * PAGE, (pageNum + 1) * PAGE - 1);

    if (!inactive) q = q.eq('activo', true);

    const { data } = await q;
    if (data) {
      const rows = data as Tx[];
      setTxs(prev => reset ? rows : [...prev, ...rows]);
      setHasMore(rows.length === PAGE);
    }
    setLoading(false);
    setLoadingMore(false);
  }

  const toggleFilter = () => {
    const next = !showInactive;
    setShowInactive(next);
    setPage(0);
    fetchTxs(0, next, true);
  };

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    fetchTxs(next, showInactive, false);
  };

  const openEdit = (tx: Tx) => {
    setEditing(tx);
    setEditMonto(String(tx.monto));
    setEditCat(tx.categoria);
    setEditDesc(tx.descripcion ?? '');
  };

  const handleSave = async () => {
    if (!editing) return;
    const m = parseFloat(editMonto.replace(',', '.'));
    if (isNaN(m) || m <= 0) return;
    setSaving(true);

    if (
      editing.tipo === 'gasto' &&
      editing.metodo_pago === 'tarjeta' &&
      editing.tarjeta_id &&
      m !== Number(editing.monto)
    ) {
      const { data: t } = await supabase
        .from('tarjetas_credito')
        .select('deuda_actual')
        .eq('id', editing.tarjeta_id)
        .single();
      if (t) {
        const nuevaDeuda = Math.max(0, Number(t.deuda_actual) + (m - Number(editing.monto)));
        await supabase
          .from('tarjetas_credito')
          .update({ deuda_actual: nuevaDeuda })
          .eq('id', editing.tarjeta_id);
      }
    }

    await supabase.from('transacciones').update({
      monto: m,
      categoria: editCat,
      descripcion: editDesc.trim() || null,
    }).eq('id', editing.id);

    setTxs(prev => prev.map(t =>
      t.id === editing!.id
        ? { ...t, monto: m, categoria: editCat, descripcion: editDesc.trim() || null }
        : t
    ));
    setEditing(null);
    setSaving(false);
  };

  const handleDeactivate = async () => {
    if (!confirmTx) return;
    setDeactivating(true);
    await supabase.from('transacciones').update({ activo: false }).eq('id', confirmTx.id);
    setTxs(prev =>
      showInactive
        ? prev.map(t => t.id === confirmTx.id ? { ...t, activo: false } : t)
        : prev.filter(t => t.id !== confirmTx.id)
    );
    setConfirmTx(null);
    setDeactivating(false);
  };

  const cats = editing?.tipo === 'ingreso' ? INGRESO_CATS : GASTO_CATS;

  const deactivateNote = () => {
    if (!confirmTx) return '';
    switch (confirmTx.categoria) {
      case 'Pago Tarjeta':    return 'La deuda de la tarjeta se restaurará al monto de este pago.';
      case 'Abono Préstamo':  return 'El saldo pendiente del préstamo aumentará en este monto.';
      case 'Ahorro':          return 'El saldo de la cuenta de ahorro se reducirá en este monto.';
      case 'Retiro Ahorro':   return 'El saldo de la cuenta de ahorro aumentará en este monto.';
      default:
        return confirmTx.metodo_pago === 'tarjeta'
          ? 'La deuda de la tarjeta se reducirá automáticamente.' : '';
    }
  };

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>‹ Volver</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Historial</Text>
        <TouchableOpacity onPress={toggleFilter} style={styles.filterBtn}>
          <Text style={styles.filterText}>{showInactive ? 'Solo activos' : 'Ver todos'}</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color="#3B82F6" style={{ marginTop: 48 }} />
      ) : (
        <FlatList
          data={txs}
          keyExtractor={t => t.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>💸</Text>
              <Text style={styles.emptyText}>Sin transacciones</Text>
            </View>
          }
          ListFooterComponent={
            hasMore ? (
              <TouchableOpacity onPress={loadMore} style={styles.loadMoreBtn} disabled={loadingMore}>
                {loadingMore
                  ? <ActivityIndicator color="#3B82F6" />
                  : <Text style={styles.loadMoreText}>Cargar más</Text>
                }
              </TouchableOpacity>
            ) : null
          }
          renderItem={({ item: tx }) => (
            <View style={[styles.txRow, !tx.activo && styles.txInactive]}>
              <View style={styles.txIconWrap}>
                <Text style={styles.txIconText}>{ICON[tx.categoria] ?? '📦'}</Text>
              </View>
              <View style={styles.txInfo}>
                <Text style={styles.txDesc} numberOfLines={1}>
                  {tx.descripcion || tx.categoria}
                </Text>
                <Text style={styles.txMeta}>
                  {tx.categoria}
                  {' · '}
                  {new Date(tx.creado_en).toLocaleDateString('es-PE', {
                    day: '2-digit', month: 'short', year: '2-digit',
                  })}
                  {tx.metodo_pago === 'tarjeta' ? ' · 💳' : ''}
                  {!tx.activo ? ' · desactivado' : ''}
                </Text>
              </View>
              <Text style={[
                styles.txAmount,
                tx.tipo === 'ingreso' ? styles.green : styles.red,
                !tx.activo && styles.inactive,
              ]}>
                {tx.tipo === 'ingreso' ? '+' : '−'}{fmt(Number(tx.monto))}
              </Text>
              {tx.activo && (
                <View style={styles.txActions}>
                  <TouchableOpacity onPress={() => openEdit(tx)} style={styles.actionBtn}>
                    <Text style={styles.editIcon}>✎</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setConfirmTx(tx)} style={[styles.actionBtn, styles.delBtn]}>
                    <Text style={styles.delIcon}>✕</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        />
      )}

      {/* ── Edit modal ── */}
      <Modal visible={!!editing} animationType="slide" transparent>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Editar Transacción</Text>

            <Text style={styles.fieldLabel}>Monto</Text>
            <TextInput
              style={styles.input}
              keyboardType="decimal-pad"
              value={editMonto}
              onChangeText={setEditMonto}
            />

            <Text style={styles.fieldLabel}>Categoría</Text>
            <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowCatPicker(true)}>
              <Text style={styles.pickerBtnText}>{editCat || 'Seleccionar'}</Text>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>

            <Text style={styles.fieldLabel}>Descripción</Text>
            <TextInput
              style={styles.input}
              value={editDesc}
              onChangeText={setEditDesc}
              placeholder="Opcional"
              placeholderTextColor="#9CA3AF"
            />

            {editing?.metodo_pago === 'tarjeta' && (
              <Text style={styles.note}>
                El ajuste de monto actualizará la deuda de la tarjeta automáticamente.
              </Text>
            )}

            <View style={styles.rowBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditing(null)}>
                <Text style={styles.cancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, saving && styles.btnDisabled]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.saveBtnText}>Guardar</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Category picker ── */}
      <Modal visible={showCatPicker} animationType="slide" transparent>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Seleccionar Categoría</Text>
            {cats.map(cat => (
              <TouchableOpacity
                key={cat}
                style={styles.catRow}
                onPress={() => { setEditCat(cat); setShowCatPicker(false); }}
              >
                <Text style={styles.catText}>{ICON[cat] ?? '📦'}  {cat}</Text>
                {editCat === cat && <Text style={styles.check}>✓</Text>}
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={[styles.cancelBtn, { marginTop: 8 }]} onPress={() => setShowCatPicker(false)}>
              <Text style={styles.cancelText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Deactivate confirm ── */}
      <Modal visible={!!confirmTx} animationType="fade" transparent>
        <View style={styles.overlay}>
          <View style={[styles.sheet, styles.confirmSheet]}>
            <Text style={styles.sheetTitle}>¿Desactivar transacción?</Text>
            <Text style={styles.confirmText}>
              La transacción se marcará como inactiva y se excluirá del balance.
              {deactivateNote() ? ` ${deactivateNote()}` : ''}
            </Text>
            <View style={styles.rowBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setConfirmTx(null)}>
                <Text style={styles.cancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, styles.dangerBtn, deactivating && styles.btnDisabled]}
                onPress={handleDeactivate}
                disabled={deactivating}
              >
                {deactivating
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.saveBtnText}>Desactivar</Text>
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
  screen:  { flex: 1, backgroundColor: '#F3F4F6' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: isWeb ? 20 : 56, paddingHorizontal: 20, paddingBottom: 16,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  backBtn:    { width: 70 },
  backText:   { fontSize: 16, color: '#3B82F6', fontWeight: '500' },
  title:      { fontSize: 18, fontWeight: '700', color: '#111827' },
  filterBtn:  { width: 70, alignItems: 'flex-end' },
  filterText: { fontSize: 13, color: '#3B82F6', fontWeight: '500' },

  list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 },

  txRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 12,
  },
  txInactive: { opacity: 0.5 },
  txIconWrap: {
    width: 40, height: 40, borderRadius: 10, backgroundColor: '#F3F4F6',
    justifyContent: 'center', alignItems: 'center', marginRight: 10, flexShrink: 0,
  },
  txIconText: { fontSize: 18 },
  txInfo:     { flex: 1, minWidth: 0 },
  txDesc:     { fontSize: 14, fontWeight: '600', color: '#111827' },
  txMeta:     { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  txAmount:   { fontSize: 14, fontWeight: '700', flexShrink: 0, marginLeft: 8 },
  txActions:  { flexDirection: 'row', gap: 6, marginLeft: 8, flexShrink: 0 },
  actionBtn:  {
    width: 30, height: 30, borderRadius: 8, backgroundColor: '#EFF6FF',
    justifyContent: 'center', alignItems: 'center',
  },
  editIcon:   { fontSize: 14, color: '#3B82F6' },
  delBtn:     { backgroundColor: '#FEF2F2' },
  delIcon:    { fontSize: 12, color: '#EF4444' },

  sep:  { height: 6 },
  green: { color: '#059669' },
  red:   { color: '#DC2626' },
  inactive: { color: '#9CA3AF' },

  empty:     { alignItems: 'center', paddingVertical: 48 },
  emptyIcon: { fontSize: 36, marginBottom: 10 },
  emptyText: { fontSize: 15, color: '#9CA3AF' },

  loadMoreBtn: {
    alignItems: 'center', paddingVertical: 16,
    backgroundColor: '#fff', borderRadius: 12, marginTop: 6,
  },
  loadMoreText: { fontSize: 14, color: '#3B82F6', fontWeight: '500' },

  // Modals
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end', alignItems: 'center',
  },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    width: '100%', maxWidth: 600, padding: 24, paddingBottom: 36,
  },
  confirmSheet: { maxWidth: 440, alignSelf: 'center', borderRadius: 20, marginBottom: 80 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: '#111827', marginBottom: 20 },

  fieldLabel: { fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 },
  input: {
    height: 48, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: 10, paddingHorizontal: 14, fontSize: 15, color: '#111827', marginBottom: 14,
  },
  pickerBtn: {
    height: 48, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: 10, paddingHorizontal: 14, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-between', marginBottom: 14,
  },
  pickerBtnText: { fontSize: 15, color: '#111827' },
  chevron:       { fontSize: 20, color: '#9CA3AF' },
  note: { fontSize: 12, color: '#0891B2', marginBottom: 16, lineHeight: 18 },
  confirmText: { fontSize: 14, color: '#6B7280', lineHeight: 20, marginBottom: 24 },

  rowBtns: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn: {
    flex: 1, height: 48, backgroundColor: '#F3F4F6', borderRadius: 10,
    justifyContent: 'center', alignItems: 'center',
  },
  cancelText:  { fontSize: 15, color: '#374151', fontWeight: '500' },
  saveBtn: {
    flex: 1, height: 48, backgroundColor: '#3B82F6', borderRadius: 10,
    justifyContent: 'center', alignItems: 'center',
  },
  saveBtnText: { fontSize: 15, color: '#fff', fontWeight: '600' },
  dangerBtn:   { backgroundColor: '#DC2626' },
  btnDisabled: { opacity: 0.6 },

  catRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  catText: { fontSize: 15, color: '#374151' },
  check:   { fontSize: 16, color: '#3B82F6', fontWeight: '600' },
});
