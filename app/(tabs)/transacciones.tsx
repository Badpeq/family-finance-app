import { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Platform, ActivityIndicator, Modal, TextInput, SafeAreaView,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useCategorias, BASE_INCOME_CATS, iconForCat } from '@/hooks/useCategorias';

interface Tx {
  id: string;
  tipo: 'ingreso'|'gasto';
  monto: number;
  categoria: string;
  descripcion: string|null;
  metodo_pago: 'efectivo'|'tarjeta'|null;
  tarjeta_id: string|null;
  activo: boolean;
  creado_en: string;
}

const PAGE = 30;

const SYM: Record<string,string> = { PEN:'S/', USD:'$', EUR:'€', BRL:'R$', COP:'$', MXN:'$', ARS:'$', CLP:'$' };

export default function Transacciones() {
  const [txs,          setTxs]          = useState<Tx[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [currency,     setCurrency]     = useState('PEN');
  const [showInactive, setShowInactive] = useState(false);
  const [page,         setPage]         = useState(0);
  const [hasMore,      setHasMore]      = useState(true);
  const [loadingMore,  setLoadingMore]  = useState(false);

  const { categorias: catGasto } = useCategorias();

  // Edit modal
  const [editing,       setEditing]       = useState<Tx|null>(null);
  const [editMonto,     setEditMonto]     = useState('');
  const [editCat,       setEditCat]       = useState('');
  const [editDesc,      setEditDesc]      = useState('');
  const [showCatPicker, setShowCatPicker] = useState(false);
  const [saving,        setSaving]        = useState(false);

  // Deactivate confirm
  const [confirmTx,    setConfirmTx]    = useState<Tx|null>(null);
  const [deactivating, setDeactivating] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      (async () => {
        const { data:{ user } } = await supabase.auth.getUser();
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

  const sym = SYM[currency] ?? currency;
  const fmt = (n: number) => `${sym} ${n.toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2})}`;

  async function fetchTxs(pageNum: number, inactive: boolean, reset: boolean) {
    if (reset) setLoading(true); else setLoadingMore(true);
    const { data:{ user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); setLoadingMore(false); return; }
    const from = pageNum * PAGE;
    let q = supabase.from('transacciones')
      .select('id,tipo,monto,categoria,descripcion,metodo_pago,tarjeta_id,activo,creado_en')
      .eq('user_id', user.id)
      .order('creado_en', { ascending: false })
      .range(from, from + PAGE - 1);
    if (!inactive) q = q.eq('activo', true);
    const { data } = await q;
    if (reset) setTxs(data ?? []);
    else setTxs(prev => [...prev, ...(data ?? [])]);
    setHasMore((data?.length ?? 0) === PAGE);
    setLoading(false);
    setLoadingMore(false);
  }

  const openEdit = (tx: Tx) => {
    setEditing(tx);
    setEditMonto(String(Number(tx.monto)));
    setEditCat(tx.categoria);
    setEditDesc(tx.descripcion ?? '');
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    const m = parseFloat(editMonto.replace(',','.'));
    if (isNaN(m) || m <= 0) return;
    setSaving(true);
    const { error } = await supabase.from('transacciones')
      .update({ monto: m, categoria: editCat, descripcion: editDesc.trim() || null })
      .eq('id', editing.id);
    if (!error) {
      setTxs(prev => prev.map(t => t.id === editing.id ? {...t, monto: m, categoria: editCat, descripcion: editDesc.trim() || null} : t));
      setEditing(null);
    }
    setSaving(false);
  };

  const handleDeactivate = async () => {
    if (!confirmTx) return;
    setDeactivating(true);
    await supabase.from('transacciones').update({ activo: false }).eq('id', confirmTx.id);
    setTxs(prev => showInactive ? prev.map(t => t.id === confirmTx.id ? {...t, activo: false} : t) : prev.filter(t => t.id !== confirmTx.id));
    setConfirmTx(null);
    setDeactivating(false);
  };

  const toggleShowInactive = () => {
    const next = !showInactive;
    setShowInactive(next);
    setPage(0);
    fetchTxs(0, next, true);
  };

  const cats = editing?.tipo === 'ingreso' ? BASE_INCOME_CATS : catGasto;

  function GroupHeader({ date }: { date: string }) {
    const d = new Date(date);
    return (
      <Text style={styles.groupHeader}>
        {d.toLocaleDateString('es-PE', { weekday:'long', day:'2-digit', month:'long' })}
      </Text>
    );
  }

  // Group by day
  type ListItem = { type:'header'; date:string } | { type:'tx'; tx:Tx };
  const items: ListItem[] = [];
  let lastDay = '';
  for (const tx of txs) {
    const day = tx.creado_en.slice(0, 10);
    if (day !== lastDay) { items.push({ type:'header', date: tx.creado_en }); lastDay = day; }
    items.push({ type:'tx', tx });
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#F8F9FB' }}>
      <SafeAreaView style={{ backgroundColor: '#F8F9FB' }}>
        <View style={styles.header}>
          <Text style={styles.title}>Movimientos</Text>
          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.importBtn} onPress={() => router.push('/importar')}>
              <Text style={styles.importText}>📥 Importar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.filterBtn} onPress={toggleShowInactive}>
              <Text style={[styles.filterText, showInactive && { color: '#DC2626' }]}>
                {showInactive ? 'Solo activos' : 'Ver todos'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>

      {loading ? (
        <ActivityIndicator color="#3B82F6" style={{ marginTop: 60 }} />
      ) : txs.length === 0 ? (
        <View style={styles.empty}>
          <Text style={{ fontSize: 40, marginBottom: 12 }}>📭</Text>
          <Text style={styles.emptyTitle}>Sin transacciones</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push('/registrar?tipo=gasto')}>
            <Text style={styles.emptyBtnText}>Registrar primera transacción</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item, idx) => item.type === 'header' ? `h-${item.date}` : item.tx.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
          renderItem={({ item }) => {
            if (item.type === 'header') return <GroupHeader date={item.date} />;
            const tx = item.tx;
            return (
              <View style={[styles.txCard, !tx.activo && styles.txInactive]}>
                <View style={styles.txIconBox}>
                  <Text style={{ fontSize: 20 }}>{iconForCat(tx.categoria, catGasto)}</Text>
                </View>
                <View style={styles.txBody}>
                  <Text style={styles.txDesc} numberOfLines={1}>{tx.descripcion || tx.categoria}</Text>
                  <Text style={styles.txMeta}>
                    {tx.categoria}
                    {tx.metodo_pago === 'tarjeta' ? ' · 💳' : ''}
                    {!tx.activo ? ' · anulado' : ''}
                  </Text>
                </View>
                <View style={{ alignItems:'flex-end' }}>
                  <Text style={[styles.txAmt, tx.tipo === 'ingreso' ? styles.green : styles.red]}>
                    {tx.tipo === 'ingreso' ? '+' : '−'}{fmt(Number(tx.monto))}
                  </Text>
                  {tx.activo && (
                    <View style={{ flexDirection:'row', gap:12, marginTop:4 }}>
                      <TouchableOpacity onPress={() => openEdit(tx)}>
                        <Text style={styles.actionLink}>Editar</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setConfirmTx(tx)}>
                        <Text style={[styles.actionLink, { color: '#DC2626' }]}>Anular</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </View>
            );
          }}
          onEndReached={() => { if (hasMore && !loadingMore) { const next = page+1; setPage(next); fetchTxs(next, showInactive, false); } }}
          onEndReachedThreshold={0.3}
          ListFooterComponent={loadingMore ? <ActivityIndicator color="#3B82F6" style={{ marginVertical: 16 }} /> : null}
        />
      )}

      {/* ── Edit Modal ── */}
      <Modal visible={!!editing} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Editar transacción</Text>
              <TouchableOpacity onPress={() => setEditing(null)}>
                <Text style={styles.modalClose}>Cancelar</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.modalBody}>
              <Text style={styles.mLabel}>Monto</Text>
              <TextInput style={styles.mInput} keyboardType="decimal-pad" value={editMonto}
                onChangeText={setEditMonto} placeholderTextColor="#9CA3AF" />
              <Text style={styles.mLabel}>Categoría</Text>
              <TouchableOpacity style={styles.mInput} onPress={() => setShowCatPicker(true)}>
                <Text style={{ color:'#111827', fontSize:15 }}>{iconForCat(editCat, catGasto)} {editCat}</Text>
              </TouchableOpacity>
              <Text style={styles.mLabel}>Descripción</Text>
              <TextInput style={styles.mInput} value={editDesc} onChangeText={setEditDesc}
                placeholder="(opcional)" placeholderTextColor="#9CA3AF" />
              <TouchableOpacity
                style={[styles.mSaveBtn, saving && { opacity:0.6 }]}
                onPress={handleSaveEdit} disabled={saving}
              >
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.mSaveText}>Guardar cambios</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Cat Picker ── */}
      <Modal visible={showCatPicker} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { maxHeight:'60%' }]}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Categoría</Text>
              <TouchableOpacity onPress={() => setShowCatPicker(false)}>
                <Text style={styles.modalClose}>Cerrar</Text>
              </TouchableOpacity>
            </View>
            {cats.map((cat, i) => (
              <View key={cat.nombre}>
                <TouchableOpacity style={styles.catOpt} onPress={() => { setEditCat(cat.nombre); setShowCatPicker(false); }}>
                  <Text style={styles.catOptText}>{cat.icono} {cat.nombre}</Text>
                  {editCat === cat.nombre && <Text style={{ color:'#3B82F6', fontSize:18 }}>✓</Text>}
                </TouchableOpacity>
                {i < cats.length - 1 && <View style={styles.sep} />}
              </View>
            ))}
          </View>
        </View>
      </Modal>

      {/* ── Confirm Deactivate ── */}
      <Modal visible={!!confirmTx} animationType="fade" transparent>
        <View style={styles.confirmBackdrop}>
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitle}>¿Anular esta transacción?</Text>
            <Text style={styles.confirmSub}>
              Se revertirán los efectos sobre saldos, deudas o ahorros.
            </Text>
            <View style={styles.confirmBtns}>
              <TouchableOpacity style={styles.confirmCancel} onPress={() => setConfirmTx(null)}>
                <Text style={styles.confirmCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmDanger, deactivating && { opacity:0.6 }]}
                onPress={handleDeactivate} disabled={deactivating}
              >
                {deactivating ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmDangerText}>Sí, anular</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header:        { flexDirection:'row', justifyContent:'space-between', alignItems:'center',
                   paddingHorizontal:20, paddingTop: Platform.OS === 'android' ? 44 : 12, paddingBottom:12,
                   borderBottomWidth:1, borderBottomColor:'#F3F4F6' },
  title:         { fontSize:20, fontWeight:'800', color:'#111827' },
  headerActions: { flexDirection:'row', alignItems:'center', gap:8 },
  importBtn:     { paddingHorizontal:11, paddingVertical:6, backgroundColor:'#EDE9FE', borderRadius:8 },
  importText:    { fontSize:12, color:'#5B21B6', fontWeight:'700' },
  filterBtn:     { paddingHorizontal:12, paddingVertical:6, backgroundColor:'#F3F4F6', borderRadius:8 },
  filterText:    { fontSize:13, color:'#6B7280', fontWeight:'500' },

  empty:      { flex:1, justifyContent:'center', alignItems:'center', padding:40 },
  emptyTitle: { fontSize:16, fontWeight:'600', color:'#374151', marginBottom:16 },
  emptyBtn:   { backgroundColor:'#3B82F6', paddingHorizontal:20, paddingVertical:12, borderRadius:12 },
  emptyBtnText:{ color:'#fff', fontWeight:'600', fontSize:14 },

  groupHeader:{ fontSize:12, fontWeight:'600', color:'#9CA3AF', textTransform:'uppercase',
                letterSpacing:0.5, paddingTop:16, paddingBottom:8 },
  txCard:     { backgroundColor:'#fff', borderRadius:14, padding:14, marginBottom:8,
                flexDirection:'row', alignItems:'center',
                shadowColor:'#000', shadowOpacity:0.04, shadowRadius:4, elevation:1 },
  txInactive: { opacity:0.5 },
  txIconBox:  { width:40, height:40, borderRadius:12, backgroundColor:'#F3F4F6',
                justifyContent:'center', alignItems:'center', marginRight:12, flexShrink:0 },
  txBody:     { flex:1, minWidth:0 },
  txDesc:     { fontSize:14, fontWeight:'600', color:'#111827' },
  txMeta:     { fontSize:11, color:'#9CA3AF', marginTop:2 },
  txAmt:      { fontSize:15, fontWeight:'700' },
  actionLink: { fontSize:11, color:'#6B7280', fontWeight:'500' },
  green:      { color:'#059669' },
  red:        { color:'#DC2626' },

  modalBackdrop:{ flex:1, backgroundColor:'rgba(0,0,0,0.45)', justifyContent:'flex-end', alignItems:'center' },
  modalSheet:   { backgroundColor:'#fff', borderTopLeftRadius:24, borderTopRightRadius:24,
                  width:'100%', maxWidth:600, maxHeight:'80%' },
  modalHead:    { flexDirection:'row', justifyContent:'space-between', alignItems:'center',
                  paddingHorizontal:20, paddingVertical:16, borderBottomWidth:1, borderBottomColor:'#F3F4F6' },
  modalTitle:   { fontSize:16, fontWeight:'700', color:'#111827' },
  modalClose:   { fontSize:14, color:'#3B82F6', fontWeight:'500' },
  modalBody:    { padding:20, paddingBottom:36 },
  mLabel:       { fontSize:13, fontWeight:'500', color:'#374151', marginBottom:6, marginTop:14 },
  mInput:       { height:50, backgroundColor:'#F9FAFB', borderWidth:1, borderColor:'#E5E7EB',
                  borderRadius:12, paddingHorizontal:14, fontSize:15, color:'#111827', justifyContent:'center' },
  mSaveBtn:     { height:50, backgroundColor:'#3B82F6', borderRadius:12,
                  justifyContent:'center', alignItems:'center', marginTop:20 },
  mSaveText:    { color:'#fff', fontSize:15, fontWeight:'600' },
  catOpt:       { flexDirection:'row', justifyContent:'space-between', alignItems:'center',
                  paddingHorizontal:20, paddingVertical:14 },
  catOptText:   { fontSize:15, color:'#111827' },
  sep:          { height:1, backgroundColor:'#F3F4F6' },

  confirmBackdrop:{ flex:1, backgroundColor:'rgba(0,0,0,0.5)', justifyContent:'center', alignItems:'center', padding:20 },
  confirmBox:     { backgroundColor:'#fff', borderRadius:20, padding:24, width:'100%', maxWidth:340 },
  confirmTitle:   { fontSize:17, fontWeight:'700', color:'#111827', marginBottom:8 },
  confirmSub:     { fontSize:14, color:'#6B7280', lineHeight:20, marginBottom:20 },
  confirmBtns:    { flexDirection:'row', gap:10 },
  confirmCancel:  { flex:1, height:46, backgroundColor:'#F3F4F6', borderRadius:12, justifyContent:'center', alignItems:'center' },
  confirmCancelText:{ fontSize:15, color:'#374151', fontWeight:'500' },
  confirmDanger:  { flex:1, height:46, backgroundColor:'#DC2626', borderRadius:12, justifyContent:'center', alignItems:'center' },
  confirmDangerText:{ fontSize:15, color:'#fff', fontWeight:'600' },
});
