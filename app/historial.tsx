import { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Platform, ActivityIndicator, Modal, TextInput, ScrollView, Switch,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useCategorias, BASE_INCOME_CATS, iconForCat } from '@/hooks/useCategorias';

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
  fecha: string | null;
  moneda: string | null;
  es_gasto_unico: boolean | null;
  subcategoria_id: string | null;
}

const PAGE = 30;
const SYM: Record<string, string> = {
  PEN: 'S/', USD: '$', EUR: '€', BRL: 'R$', COP: '$', MXN: '$', ARS: '$', CLP: '$',
};
const CURRENCIES = ['PEN', 'USD', 'EUR', 'BRL', 'COP', 'MXN', 'ARS', 'CLP'];

function parseFechaEdit(input: string): string | null {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(input.trim())) return null;
  const [dd, mm, yyyy] = input.split('/');
  const d = parseInt(dd, 10), m = parseInt(mm, 10), y = parseInt(yyyy, 10);
  if (d < 1 || d > 31 || m < 1 || m > 12 || y < 2020 || y > 2100) return null;
  return `${yyyy}-${mm}-${dd}`;
}

export default function Historial() {
  const [txs,          setTxs]          = useState<Tx[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [currency,     setCurrency]     = useState('PEN');
  const [showInactive, setShowInactive] = useState(false);
  const [page,         setPage]         = useState(0);
  const [hasMore,      setHasMore]      = useState(true);
  const [loadingMore,  setLoadingMore]  = useState(false);

  const { categorias: catGasto } = useCategorias();

  // Edit state
  const [editing,          setEditing]          = useState<Tx | null>(null);
  const [editMonto,        setEditMonto]        = useState('');
  const [editCat,          setEditCat]          = useState('');
  const [editDesc,         setEditDesc]         = useState('');
  const [editFecha,        setEditFecha]        = useState('');
  const [editMoneda,       setEditMoneda]       = useState('PEN');
  const [editUnico,        setEditUnico]        = useState(false);
  const [editSubcatId,     setEditSubcatId]     = useState<string | null>(null);
  const [subcats,          setSubcats]          = useState<{ id: string; nombre: string }[]>([]);
  const [showCatPicker,    setShowCatPicker]    = useState(false);
  const [showMonedaPicker, setShowMonedaPicker] = useState(false);
  const [showSubcatPicker, setShowSubcatPicker] = useState(false);
  const [saving,           setSaving]           = useState(false);
  const [saveError,        setSaveError]        = useState('');

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
        if (mounted && data) setCurrency((data as any).moneda_base);
      })();
      setPage(0);
      setShowInactive(false);
      fetchTxs(0, false, true);
      return () => { mounted = false; };
    }, [])
  );

  const fmtTx = (tx: Tx) => {
    const mon = tx.moneda ?? currency;
    return `${SYM[mon] ?? mon} ${Number(tx.monto).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  async function fetchTxs(pageNum: number, inactive: boolean, reset: boolean) {
    if (reset) setLoading(true); else setLoadingMore(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); setLoadingMore(false); return; }

    let q = supabase
      .from('transacciones')
      .select('id,tipo,monto,categoria,descripcion,metodo_pago,tarjeta_id,prestamo_id,cuenta_ahorro_id,activo,creado_en,fecha,moneda,es_gasto_unico,subcategoria_id')
      .eq('user_id', user.id)
      .order('fecha', { ascending: false })
      .order('creado_en', { ascending: false })
      .range(pageNum * PAGE, (pageNum + 1) * PAGE - 1);

    if (!inactive) q = q.eq('activo', true);

    const { data } = await q;
    if (data) {
      setTxs(prev => reset ? (data as Tx[]) : [...prev, ...(data as Tx[])]);
      setHasMore((data as Tx[]).length === PAGE);
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

  const loadSubcats = async (cat: string) => {
    const { data } = await supabase
      .from('subcategorias')
      .select('id, nombre')
      .eq('categoria_nombre', cat)
      .order('nombre');
    setSubcats(data && data.length > 0 ? (data as { id: string; nombre: string }[]) : []);
  };

  const openEdit = (tx: Tx) => {
    setSaveError('');
    setEditing(tx);
    setEditMonto(String(tx.monto));
    setEditCat(tx.categoria);
    setEditDesc(tx.descripcion ?? '');
    setEditMoneda(tx.moneda ?? 'PEN');
    setEditUnico(tx.es_gasto_unico ?? false);
    setEditSubcatId(tx.subcategoria_id ?? null);
    const raw = tx.fecha ?? tx.creado_en.slice(0, 10);
    const [y, mo, d] = raw.split('-');
    setEditFecha(`${d}/${mo}/${y}`);
    setSubcats([]);
    if (tx.tipo === 'gasto') loadSubcats(tx.categoria);
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaveError('');

    const m = parseFloat(editMonto.replace(',', '.'));
    if (isNaN(m) || m <= 0) {
      setSaveError('El monto debe ser un número mayor a 0.');
      return;
    }

    const fechaParsed = parseFechaEdit(editFecha);
    if (!fechaParsed) {
      setSaveError('Fecha inválida. Usa el formato DD/MM/AAAA (ej: 15/06/2025).');
      return;
    }

    setSaving(true);

    if (
      editing.tipo === 'gasto' &&
      editing.metodo_pago === 'tarjeta' &&
      editing.tarjeta_id &&
      m !== Number(editing.monto)
    ) {
      const { data: tc } = await supabase
        .from('tarjetas_credito')
        .select('deuda_actual')
        .eq('id', editing.tarjeta_id)
        .single();
      if (tc) {
        const nuevaDeuda = Math.max(0, Number((tc as any).deuda_actual) + (m - Number(editing.monto)));
        await supabase.from('tarjetas_credito').update({ deuda_actual: nuevaDeuda }).eq('id', editing.tarjeta_id);
      }
    }

    const updates: Record<string, unknown> = {
      monto:       m,
      categoria:   editCat,
      descripcion: editDesc.trim() || null,
      moneda:      editMoneda,
      fecha:       fechaParsed,
      ...(editing.tipo === 'gasto' ? {
        es_gasto_unico:  editUnico,
        subcategoria_id: editSubcatId ?? null,
      } : {}),
    };

    const { error } = await supabase.from('transacciones').update(updates).eq('id', editing.id);

    if (error) {
      setSaveError(`Error al guardar: ${error.message}`);
      setSaving(false);
      return;
    }

    const savedId = editing.id;
    setTxs(prev => prev.map(t =>
      t.id === savedId
        ? { ...t, ...updates } as Tx
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
        ? prev.map(t => t.id === confirmTx!.id ? { ...t, activo: false } : t)
        : prev.filter(t => t.id !== confirmTx!.id)
    );
    setConfirmTx(null);
    setDeactivating(false);
  };

  const cats        = editing?.tipo === 'ingreso' ? BASE_INCOME_CATS : catGasto;
  const subcatName  = subcats.find(s => s.id === editSubcatId)?.nombre ?? null;

  const deactivateNote = () => {
    if (!confirmTx) return '';
    switch (confirmTx.categoria) {
      case 'Pago Tarjeta':   return 'La deuda de la tarjeta se restaurará al monto de este pago.';
      case 'Abono Préstamo': return 'El saldo pendiente del préstamo aumentará en este monto.';
      case 'Ahorro':         return 'El saldo de la cuenta de ahorro se reducirá en este monto.';
      case 'Retiro Ahorro':  return 'El saldo de la cuenta de ahorro aumentará en este monto.';
      default:
        return confirmTx.metodo_pago === 'tarjeta'
          ? 'La deuda de la tarjeta se reducirá automáticamente.' : '';
    }
  };

  return (
    <View style={s.screen}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>‹ Volver</Text>
        </TouchableOpacity>
        <Text style={s.title}>Historial</Text>
        <TouchableOpacity onPress={toggleFilter} style={s.filterBtn}>
          <Text style={s.filterText}>{showInactive ? 'Solo activos' : 'Ver todos'}</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color="#3B82F6" style={{ marginTop: 48 }} />
      ) : (
        <FlatList
          data={txs}
          keyExtractor={t => t.id}
          contentContainerStyle={s.list}
          ItemSeparatorComponent={() => <View style={s.sep} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={s.emptyIcon}>💸</Text>
              <Text style={s.emptyText}>Sin transacciones</Text>
            </View>
          }
          ListFooterComponent={
            hasMore ? (
              <TouchableOpacity onPress={loadMore} style={s.loadMoreBtn} disabled={loadingMore}>
                {loadingMore
                  ? <ActivityIndicator color="#3B82F6" />
                  : <Text style={s.loadMoreText}>Cargar más</Text>}
              </TouchableOpacity>
            ) : null
          }
          renderItem={({ item: tx }) => (
            <View style={[s.txRow, !tx.activo && s.txInactive]}>
              <View style={s.txIconWrap}>
                <Text style={s.txIconText}>{iconForCat(tx.categoria, catGasto)}</Text>
              </View>
              <View style={s.txInfo}>
                <View style={s.txTitleRow}>
                  <Text style={s.txDesc} numberOfLines={1}>{tx.descripcion || tx.categoria}</Text>
                  {tx.es_gasto_unico && (
                    <View style={s.unicoBadge}><Text style={s.unicoBadgeText}>⚡</Text></View>
                  )}
                </View>
                <Text style={s.txMeta}>
                  {tx.categoria}
                  {' · '}
                  {new Date((tx.fecha ?? tx.creado_en.slice(0, 10)) + 'T12:00:00').toLocaleDateString('es-PE', {
                    day: '2-digit', month: 'short', year: '2-digit',
                  })}
                  {tx.metodo_pago === 'tarjeta' ? ' · 💳' : ''}
                  {tx.moneda && tx.moneda !== 'PEN' ? ` · ${tx.moneda}` : ''}
                  {!tx.activo ? ' · desactivado' : ''}
                </Text>
              </View>
              <Text style={[s.txAmount, tx.tipo === 'ingreso' ? s.green : s.red, !tx.activo && s.inactive]}>
                {tx.tipo === 'ingreso' ? '+' : '−'}{fmtTx(tx)}
              </Text>
              {tx.activo && (
                <View style={s.txActions}>
                  <TouchableOpacity onPress={() => openEdit(tx)} style={s.actionBtn}>
                    <Text style={s.editIcon}>✎</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setConfirmTx(tx)} style={[s.actionBtn, s.delBtn]}>
                    <Text style={s.delIcon}>✕</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        />
      )}

      {/* ── Edit modal ── */}
      <Modal visible={!!editing} animationType="slide" transparent>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle}>Editar transacción</Text>
              <TouchableOpacity onPress={() => setEditing(null)}>
                <Text style={s.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

              <Text style={s.label}>Monto</Text>
              <TextInput
                style={s.input}
                keyboardType="decimal-pad"
                value={editMonto}
                onChangeText={setEditMonto}
              />

              <Text style={s.label}>Moneda</Text>
              <TouchableOpacity style={s.picker} onPress={() => setShowMonedaPicker(true)}>
                <Text style={s.pickerText}>{SYM[editMoneda] ?? editMoneda} {editMoneda}</Text>
                <Text style={s.chevron}>›</Text>
              </TouchableOpacity>

              <Text style={s.label}>Fecha</Text>
              <TextInput
                style={s.input}
                value={editFecha}
                onChangeText={setEditFecha}
                placeholder="DD/MM/AAAA"
                placeholderTextColor="#9CA3AF"
                keyboardType="numeric"
              />

              <Text style={s.label}>Categoría</Text>
              <TouchableOpacity style={s.picker} onPress={() => setShowCatPicker(true)}>
                <Text style={s.pickerText}>{editCat || 'Seleccionar'}</Text>
                <Text style={s.chevron}>›</Text>
              </TouchableOpacity>

              {editing?.tipo === 'gasto' && subcats.length > 0 && (
                <>
                  <Text style={s.label}>
                    Subcategoría <Text style={s.optional}>(opcional)</Text>
                  </Text>
                  <TouchableOpacity style={s.picker} onPress={() => setShowSubcatPicker(true)}>
                    <Text style={editSubcatId ? s.pickerText : s.placeholder}>
                      {editSubcatId ? (subcatName ?? 'Seleccionar') : 'Sin subcategoría'}
                    </Text>
                    <Text style={s.chevron}>›</Text>
                  </TouchableOpacity>
                </>
              )}

              <Text style={s.label}>Descripción</Text>
              <TextInput
                style={s.input}
                value={editDesc}
                onChangeText={setEditDesc}
                placeholder="Opcional"
                placeholderTextColor="#9CA3AF"
              />

              {editing?.tipo === 'gasto' && (
                <View style={s.switchRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.switchLabel}>Gasto único</Text>
                    <Text style={s.switchSub}>No se prorratea en la proyección mensual</Text>
                  </View>
                  <Switch
                    value={editUnico}
                    onValueChange={setEditUnico}
                    trackColor={{ false: '#E5E7EB', true: '#C4B5FD' }}
                    thumbColor={editUnico ? '#7C3AED' : '#9CA3AF'}
                  />
                </View>
              )}

              {editing?.metodo_pago === 'tarjeta' && (
                <Text style={s.note}>
                  El ajuste de monto actualizará la deuda de la tarjeta automáticamente.
                </Text>
              )}

              {!!saveError && (
                <View style={s.errBox}>
                  <Text style={s.errText}>{saveError}</Text>
                </View>
              )}

              <View style={s.rowBtns}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setEditing(null)}>
                  <Text style={s.cancelText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.saveBtn, saving && s.btnOff]}
                  onPress={handleSave}
                  disabled={saving}
                >
                  {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveBtnText}>Guardar</Text>}
                </TouchableOpacity>
              </View>
              <View style={{ height: 24 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Moneda picker ── */}
      <Modal visible={showMonedaPicker} animationType="slide" transparent>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle}>Moneda</Text>
              <TouchableOpacity onPress={() => setShowMonedaPicker(false)}>
                <Text style={s.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>
            {CURRENCIES.map((code, i) => (
              <View key={code}>
                <TouchableOpacity
                  style={s.optRow}
                  onPress={() => { setEditMoneda(code); setShowMonedaPicker(false); }}
                >
                  <Text style={s.optText}>{SYM[code]} {code}</Text>
                  {editMoneda === code && <Text style={s.check}>✓</Text>}
                </TouchableOpacity>
                {i < CURRENCIES.length - 1 && <View style={s.optSep} />}
              </View>
            ))}
            <View style={{ height: 20 }} />
          </View>
        </View>
      </Modal>

      {/* ── Category picker ── */}
      <Modal visible={showCatPicker} animationType="slide" transparent>
        <View style={s.overlay}>
          <View style={[s.sheet, { maxHeight: '75%' }]}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle}>Categoría</Text>
              <TouchableOpacity onPress={() => setShowCatPicker(false)}>
                <Text style={s.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              {cats.map(cat => (
                <TouchableOpacity
                  key={cat.nombre}
                  style={s.catRow}
                  onPress={async () => {
                    setEditCat(cat.nombre);
                    setEditSubcatId(null);
                    setShowCatPicker(false);
                    if (editing?.tipo === 'gasto') await loadSubcats(cat.nombre);
                  }}
                >
                  <Text style={s.catText}>{cat.icono}  {cat.nombre}</Text>
                  {editCat === cat.nombre && <Text style={s.check}>✓</Text>}
                </TouchableOpacity>
              ))}
              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Subcategoría picker ── */}
      <Modal visible={showSubcatPicker} animationType="slide" transparent>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle}>Subcategoría</Text>
              <TouchableOpacity onPress={() => setShowSubcatPicker(false)}>
                <Text style={s.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={s.optRow} onPress={() => { setEditSubcatId(null); setShowSubcatPicker(false); }}>
              <Text style={s.optText}>Sin subcategoría</Text>
              {!editSubcatId && <Text style={s.check}>✓</Text>}
            </TouchableOpacity>
            <View style={s.optSep} />
            {subcats.map((sc, i) => (
              <View key={sc.id}>
                <TouchableOpacity
                  style={s.optRow}
                  onPress={() => { setEditSubcatId(sc.id); setShowSubcatPicker(false); }}
                >
                  <Text style={s.optText}>{sc.nombre}</Text>
                  {editSubcatId === sc.id && <Text style={s.check}>✓</Text>}
                </TouchableOpacity>
                {i < subcats.length - 1 && <View style={s.optSep} />}
              </View>
            ))}
            <View style={{ height: 20 }} />
          </View>
        </View>
      </Modal>

      {/* ── Deactivate confirm ── */}
      <Modal visible={!!confirmTx} animationType="fade" transparent>
        <View style={s.overlay}>
          <View style={[s.sheet, s.confirmSheet]}>
            <Text style={s.sheetTitle}>¿Desactivar transacción?</Text>
            <Text style={s.confirmText}>
              La transacción se marcará como inactiva y se excluirá del balance.
              {deactivateNote() ? ` ${deactivateNote()}` : ''}
            </Text>
            <View style={s.rowBtns}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setConfirmTx(null)}>
                <Text style={s.cancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.saveBtn, s.dangerBtn, deactivating && s.btnOff]}
                onPress={handleDeactivate}
                disabled={deactivating}
              >
                {deactivating
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.saveBtnText}>Desactivar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const isWeb = Platform.OS === 'web';

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F3F4F6' },

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

  txRow:      { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12 },
  txInactive: { opacity: 0.5 },
  txIconWrap: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center', marginRight: 10, flexShrink: 0 },
  txIconText: { fontSize: 18 },
  txInfo:     { flex: 1, minWidth: 0 },
  txTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  txDesc:     { fontSize: 14, fontWeight: '600', color: '#111827', flexShrink: 1 },
  txMeta:     { fontSize: 12, color: '#9CA3AF' },
  txAmount:   { fontSize: 14, fontWeight: '700', flexShrink: 0, marginLeft: 8 },
  txActions:  { flexDirection: 'row', gap: 6, marginLeft: 8, flexShrink: 0 },
  actionBtn:  { width: 30, height: 30, borderRadius: 8, backgroundColor: '#EFF6FF', justifyContent: 'center', alignItems: 'center' },
  editIcon:   { fontSize: 14, color: '#3B82F6' },
  delBtn:     { backgroundColor: '#FEF2F2' },
  delIcon:    { fontSize: 12, color: '#EF4444' },

  unicoBadge:     { backgroundColor: '#FEF9C3', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  unicoBadgeText: { fontSize: 10, fontWeight: '700', color: '#92400E' },

  sep:      { height: 6 },
  green:    { color: '#059669' },
  red:      { color: '#DC2626' },
  inactive: { color: '#9CA3AF' },

  empty:     { alignItems: 'center', paddingVertical: 48 },
  emptyIcon: { fontSize: 36, marginBottom: 10 },
  emptyText: { fontSize: 15, color: '#9CA3AF' },

  loadMoreBtn:  { alignItems: 'center', paddingVertical: 16, backgroundColor: '#fff', borderRadius: 12, marginTop: 6 },
  loadMoreText: { fontSize: 14, color: '#3B82F6', fontWeight: '500' },

  overlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end', alignItems: 'center' },
  sheet:       { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, width: '100%', maxWidth: 600, maxHeight: '90%', paddingHorizontal: 24 },
  confirmSheet:{ maxWidth: 440, alignSelf: 'center', borderRadius: 20, marginBottom: 80, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },

  sheetHead:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 20, paddingBottom: 16 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: '#111827' },
  closeBtn:   { fontSize: 18, color: '#9CA3AF', padding: 4 },

  label:       { fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 },
  optional:    { fontWeight: '400', color: '#9CA3AF' },
  input:       { height: 48, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, paddingHorizontal: 14, fontSize: 15, color: '#111827', marginBottom: 14 },
  picker:      { height: 48, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  pickerText:  { fontSize: 15, color: '#111827' },
  placeholder: { fontSize: 15, color: '#9CA3AF' },
  chevron:     { fontSize: 20, color: '#9CA3AF' },

  switchRow:   { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#F3F4F6', marginBottom: 4 },
  switchLabel: { fontSize: 15, fontWeight: '500', color: '#111827' },
  switchSub:   { fontSize: 12, color: '#9CA3AF', marginTop: 2 },

  note:        { fontSize: 12, color: '#0891B2', marginBottom: 16, lineHeight: 18 },
  confirmText: { fontSize: 14, color: '#6B7280', lineHeight: 20, marginBottom: 24 },
  errBox:      { backgroundColor: '#FEF2F2', borderRadius: 10, padding: 12, marginBottom: 12 },
  errText:     { color: '#DC2626', fontSize: 13, lineHeight: 18 },

  rowBtns:     { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn:   { flex: 1, height: 48, backgroundColor: '#F3F4F6', borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  cancelText:  { fontSize: 15, color: '#374151', fontWeight: '500' },
  saveBtn:     { flex: 1, height: 48, backgroundColor: '#3B82F6', borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  saveBtnText: { fontSize: 15, color: '#fff', fontWeight: '600' },
  dangerBtn:   { backgroundColor: '#DC2626' },
  btnOff:      { opacity: 0.6 },

  optRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14 },
  optText: { fontSize: 15, color: '#374151' },
  optSep:  { height: 1, backgroundColor: '#F3F4F6' },

  catRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  catText: { fontSize: 15, color: '#374151' },
  check:   { fontSize: 16, color: '#3B82F6', fontWeight: '600' },
});
