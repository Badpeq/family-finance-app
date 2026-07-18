import { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Modal, TextInput, SafeAreaView, Platform,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { T, R, MAXW } from '@/theme';

const BASE_CATS = [
  { nombre: 'Alimentación', icono: '🛒' },
  { nombre: 'Transporte',   icono: '🚗' },
  { nombre: 'Vivienda',     icono: '🏠' },
  { nombre: 'Entretenimiento', icono: '🎬' },
  { nombre: 'Salud',        icono: '💊' },
  { nombre: 'Educación',    icono: '📚' },
  { nombre: 'Ropa',         icono: '👕' },
  { nombre: 'Servicios',    icono: '⚡' },
  { nombre: 'Restaurantes', icono: '🍽️' },
  { nombre: 'Otros',        icono: '📦' },
];

const ICON_OPTS = ['📦','🛒','🚗','🏠','🎬','💊','📚','👕','⚡','🍽️','✈️','🎮','🏋️','🐶','🌱','💼','🎁','🏥','🛠️','💡','🎵','📱','🍺','☕','🏖️','🎓','🏦','🛍️'];

interface Cat { id: string; nombre: string; icono: string }
interface Subcat { id: string; nombre: string; categoria_id: string | null; categoria_nombre: string | null }
interface Regla { id: string; comercio_normalizado: string; categoria: string; veces_aplicada: number }

export default function GestionarCategorias() {
  const [userId,   setUserId]   = useState('');
  const [custom,   setCustom]   = useState<Cat[]>([]);
  const [subcats,  setSubcats]  = useState<Subcat[]>([]);
  const [reglas,   setReglas]   = useState<Regla[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // New category modal
  const [showNewCat,    setShowNewCat]    = useState(false);
  const [newCatNombre,  setNewCatNombre]  = useState('');
  const [newCatIcono,   setNewCatIcono]   = useState('📦');
  const [savingCat,     setSavingCat]     = useState(false);
  const [catError,      setCatError]      = useState('');

  // New subcategory modal
  const [showNewSub,    setShowNewSub]    = useState(false);
  const [subForCat,     setSubForCat]     = useState<{ nombre: string; id?: string } | null>(null);
  const [newSubNombre,  setNewSubNombre]  = useState('');
  const [savingSub,     setSavingSub]     = useState(false);
  const [subError,      setSubError]      = useState('');

  // Delete confirm
  const [delCat,   setDelCat]   = useState<Cat | null>(null);
  const [delSub,   setDelSub]   = useState<Subcat | null>(null);
  const [deleting, setDeleting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !active) return;
        setUserId(user.id);
        const [catRes, subRes, reglaRes] = await Promise.all([
          supabase.from('categorias_personalizadas').select('id,nombre,icono').eq('user_id', user.id).order('nombre'),
          supabase.from('subcategorias').select('id,nombre,categoria_id,categoria_nombre').eq('user_id', user.id).order('nombre'),
          supabase.from('reglas_categorizacion').select('id,comercio_normalizado,categoria,veces_aplicada').eq('user_id', user.id).order('veces_aplicada', { ascending: false }),
        ]);
        if (active) {
          setCustom((catRes.data ?? []) as Cat[]);
          setSubcats((subRes.data ?? []) as Subcat[]);
          setReglas((reglaRes.data ?? []) as Regla[]);
          setLoading(false);
        }
      })();
      return () => { active = false; };
    }, [])
  );

  const subcatsFor = (catNombre: string, catId?: string) =>
    subcats.filter(s =>
      (catId && s.categoria_id === catId) ||
      (!catId && s.categoria_nombre === catNombre && !s.categoria_id)
    );

  const handleSaveCat = async () => {
    if (!newCatNombre.trim()) { setCatError('Escribe un nombre.'); return; }
    setSavingCat(true); setCatError('');
    const { data, error } = await supabase.from('categorias_personalizadas').insert({
      user_id: userId, nombre: newCatNombre.trim(), icono: newCatIcono,
    }).select('id,nombre,icono').single();
    if (error) { setCatError(error.message); setSavingCat(false); return; }
    setCustom(prev => [...prev, data as Cat].sort((a,b) => a.nombre.localeCompare(b.nombre)));
    setShowNewCat(false); setNewCatNombre(''); setNewCatIcono('📦'); setSavingCat(false);
  };

  const handleDeleteCat = async () => {
    if (!delCat) return;
    setDeleting(true);
    await supabase.from('categorias_personalizadas').delete().eq('id', delCat.id);
    setCustom(prev => prev.filter(c => c.id !== delCat.id));
    setSubcats(prev => prev.filter(s => s.categoria_id !== delCat.id));
    setDelCat(null); setDeleting(false);
  };

  const handleSaveSub = async () => {
    if (!subForCat || !newSubNombre.trim()) { setSubError('Escribe un nombre.'); return; }
    setSavingSub(true); setSubError('');
    const payload: Record<string, unknown> = {
      user_id: userId, nombre: newSubNombre.trim(),
    };
    if (subForCat.id) {
      payload.categoria_id = subForCat.id;
    } else {
      payload.categoria_nombre = subForCat.nombre;
    }
    const { data, error } = await supabase.from('subcategorias').insert(payload).select('id,nombre,categoria_id,categoria_nombre').single();
    if (error) { setSubError(error.message); setSavingSub(false); return; }
    setSubcats(prev => [...prev, data as Subcat].sort((a,b) => a.nombre.localeCompare(b.nombre)));
    setShowNewSub(false); setNewSubNombre(''); setSavingSub(false);
  };

  const handleDeleteSub = async () => {
    if (!delSub) return;
    setDeleting(true);
    await supabase.from('subcategorias').delete().eq('id', delSub.id);
    setSubcats(prev => prev.filter(s => s.id !== delSub.id));
    setDelSub(null); setDeleting(false);
  };

  const openNewSub = (cat: { nombre: string; id?: string }) => {
    setSubForCat(cat); setNewSubNombre(''); setSubError(''); setShowNewSub(true);
  };

  const toggleExpand = (key: string) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={T.accent} />
      </View>
    );
  }

  const allCats: { nombre: string; icono: string; id?: string }[] = [
    ...BASE_CATS,
    ...custom.filter(c => !BASE_CATS.some(b => b.nombre === c.nombre)).map(c => ({
      nombre: c.nombre, icono: c.icono, id: c.id,
    })),
  ];

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>‹ Volver</Text>
        </TouchableOpacity>
        <Text style={s.title}>Categorías</Text>
        <TouchableOpacity onPress={() => { setNewCatNombre(''); setNewCatIcono('📦'); setCatError(''); setShowNewCat(true); }} style={s.addBtn}>
          <Text style={s.addBtnText}>＋ Nueva</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[s.scroll, s.constrain]}>
        <Text style={s.hint}>
          Toca una categoría para ver y gestionar sus subcategorías.
        </Text>

        {allCats.map(cat => {
          const subs = subcatsFor(cat.nombre, cat.id);
          const isOpen = !!expanded[cat.nombre];
          const isCustom = !!cat.id;
          return (
            <View key={cat.nombre} style={s.catBlock}>
              <TouchableOpacity style={s.catRow} onPress={() => toggleExpand(cat.nombre)}>
                <Text style={s.catIcon}>{cat.icono}</Text>
                <Text style={s.catName}>{cat.nombre}</Text>
                {isCustom && (
                  <Text style={s.customBadge}>personalizada</Text>
                )}
                <Text style={s.subcatCount}>{subs.length} sub</Text>
                <Text style={s.chevron}>{isOpen ? '▲' : '▼'}</Text>
                {isCustom && (
                  <TouchableOpacity
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    onPress={() => setDelCat(custom.find(c => c.id === cat.id) ?? null)}
                    style={s.delCatBtn}
                  >
                    <Text style={s.delCatIcon}>✕</Text>
                  </TouchableOpacity>
                )}
              </TouchableOpacity>

              {isOpen && (
                <View style={s.subList}>
                  {subs.length === 0 && (
                    <Text style={s.noSubs}>Sin subcategorías aún.</Text>
                  )}
                  {subs.map(sub => (
                    <View key={sub.id} style={s.subRow}>
                      <Text style={s.subName}>{sub.nombre}</Text>
                      <TouchableOpacity onPress={() => setDelSub(sub)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                        <Text style={s.delSubIcon}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                  <TouchableOpacity style={s.addSubBtn} onPress={() => openNewSub(cat)}>
                    <Text style={s.addSubText}>＋ Añadir subcategoría</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}

        {/* ── Reglas aprendidas ── */}
        {reglas.length > 0 && (
          <View style={{ marginTop: 24 }}>
            <Text style={s.reglasTitulo}>Reglas aprendidas</Text>
            <Text style={s.reglasHint}>
              Cuando aparece este comercio, la categoría se asigna automáticamente.
            </Text>
            {reglas.map(r => (
              <View key={r.id} style={s.reglaRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.reglaCom} numberOfLines={1}>{r.comercio_normalizado}</Text>
                  <Text style={s.reglaCat}>{r.categoria} · {r.veces_aplicada} uso{r.veces_aplicada !== 1 ? 's' : ''}</Text>
                </View>
                <TouchableOpacity
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={async () => {
                    await supabase.from('reglas_categorizacion').delete().eq('id', r.id);
                    setReglas(prev => prev.filter(x => x.id !== r.id));
                  }}
                >
                  <Text style={s.delCatIcon}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <View style={{ height: 48 }} />
      </ScrollView>

      {/* ── Nueva categoría personalizada ── */}
      <Modal visible={showNewCat} animationType="slide" transparent>
        <View style={s.modalBg}>
          <View style={s.modalSheet}>
            <View style={s.modalHead}>
              <Text style={s.modalTitle}>Nueva categoría</Text>
              <TouchableOpacity onPress={() => setShowNewCat(false)}>
                <Text style={s.modalClose}>Cancelar</Text>
              </TouchableOpacity>
            </View>
            <View style={s.modalBody}>
              <Text style={s.lbl}>Nombre</Text>
              <TextInput
                style={s.inp} placeholder="Ej: Mascotas"
                placeholderTextColor="#9CA3AF" value={newCatNombre}
                onChangeText={setNewCatNombre} autoFocus
              />
              <Text style={s.lbl}>Ícono</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {ICON_OPTS.map(ico => (
                    <TouchableOpacity key={ico} style={[s.iconOpt, newCatIcono === ico && s.iconOptOn]} onPress={() => setNewCatIcono(ico)}>
                      <Text style={{ fontSize: 22 }}>{ico}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
              {!!catError && <Text style={s.err}>{catError}</Text>}
              <TouchableOpacity style={[s.saveBtn, savingCat && { opacity: 0.6 }]} onPress={handleSaveCat} disabled={savingCat}>
                {savingCat ? <ActivityIndicator color="#fff" /> : <Text style={s.saveBtnText}>Crear categoría</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Nueva subcategoría ── */}
      <Modal visible={showNewSub} animationType="slide" transparent>
        <View style={s.modalBg}>
          <View style={s.modalSheet}>
            <View style={s.modalHead}>
              <Text style={s.modalTitle}>Subcategoría en {subForCat?.nombre}</Text>
              <TouchableOpacity onPress={() => setShowNewSub(false)}>
                <Text style={s.modalClose}>Cancelar</Text>
              </TouchableOpacity>
            </View>
            <View style={s.modalBody}>
              <Text style={s.lbl}>Nombre</Text>
              <TextInput
                style={s.inp} placeholder="Ej: Mercado, Metro, Wong..."
                placeholderTextColor="#9CA3AF" value={newSubNombre}
                onChangeText={setNewSubNombre} autoFocus
              />
              {!!subError && <Text style={s.err}>{subError}</Text>}
              <TouchableOpacity style={[s.saveBtn, savingSub && { opacity: 0.6 }]} onPress={handleSaveSub} disabled={savingSub}>
                {savingSub ? <ActivityIndicator color="#fff" /> : <Text style={s.saveBtnText}>Crear subcategoría</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Confirmar eliminar categoría ── */}
      <Modal visible={!!delCat} animationType="fade" transparent>
        <View style={s.confirmBg}>
          <View style={s.confirmBox}>
            <Text style={s.confirmTitle}>¿Eliminar categoría?</Text>
            <Text style={s.confirmSub}>
              Se eliminará "{delCat?.nombre}" y todas sus subcategorías. Las transacciones existentes no se borran.
            </Text>
            <View style={s.confirmBtns}>
              <TouchableOpacity style={s.confirmCancel} onPress={() => setDelCat(null)}>
                <Text style={s.confirmCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.confirmDanger, deleting && { opacity: 0.6 }]} onPress={handleDeleteCat} disabled={deleting}>
                {deleting ? <ActivityIndicator color="#fff" /> : <Text style={s.confirmDangerText}>Eliminar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Confirmar eliminar subcategoría ── */}
      <Modal visible={!!delSub} animationType="fade" transparent>
        <View style={s.confirmBg}>
          <View style={s.confirmBox}>
            <Text style={s.confirmTitle}>¿Eliminar subcategoría?</Text>
            <Text style={s.confirmSub}>
              Se eliminará "{delSub?.nombre}". Las transacciones asociadas quedarán sin subcategoría.
            </Text>
            <View style={s.confirmBtns}>
              <TouchableOpacity style={s.confirmCancel} onPress={() => setDelSub(null)}>
                <Text style={s.confirmCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.confirmDanger, deleting && { opacity: 0.6 }]} onPress={handleDeleteSub} disabled={deleting}>
                {deleting ? <ActivityIndicator color="#fff" /> : <Text style={s.confirmDangerText}>Eliminar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: T.screen },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },
  constrain: { width: '100%', maxWidth: MAXW, alignSelf: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'android' ? 44 : 12, paddingHorizontal: 20, paddingBottom: 14,
    backgroundColor: T.card, borderBottomWidth: 1, borderBottomColor: T.border,
  },
  backBtn:   { width: 60 },
  backText:  { fontSize: 16, color: T.accent, fontWeight: '500' },
  title:     { fontSize: 18, fontWeight: '700', color: T.textPrimary },
  addBtn:    { width: 70, alignItems: 'flex-end' },
  addBtnText:{ fontSize: 14, color: T.accent, fontWeight: '600' },

  scroll: { padding: 16 },
  hint:   { fontSize: 12, color: T.textMicro, marginBottom: 14, lineHeight: 17 },

  catBlock: {
    backgroundColor: T.card, borderRadius: R.card, marginBottom: 8,
    borderWidth: 1, borderColor: T.border, overflow: 'hidden',
  },
  catRow: {
    flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10,
  },
  catIcon:     { fontSize: 22, width: 28, textAlign: 'center' },
  catName:     { flex: 1, fontSize: 15, fontWeight: '600', color: T.textPrimary },
  customBadge: { fontSize: 10, color: T.accent, backgroundColor: T.accentSoft, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2, fontWeight: '600' },
  subcatCount: { fontSize: 11, color: T.textMicro, marginRight: 4 },
  chevron:     { fontSize: 12, color: T.textMicro },
  delCatBtn:   { marginLeft: 8, padding: 4 },
  delCatIcon:  { fontSize: 14, color: T.red },

  subList:    { borderTopWidth: 1, borderTopColor: T.border, padding: 12, paddingTop: 8 },
  noSubs:     { fontSize: 12, color: T.textMicro, marginBottom: 8, fontStyle: 'italic' },
  subRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: T.border },
  subName:    { fontSize: 14, color: T.textSec, flex: 1 },
  delSubIcon: { fontSize: 12, color: T.textMicro },
  addSubBtn:  { marginTop: 8, paddingVertical: 8, alignItems: 'center', borderRadius: 8, backgroundColor: T.screen },
  addSubText: { fontSize: 13, color: T.accent, fontWeight: '600' },

  modalBg:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: T.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '80%' },
  modalHead:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: T.border },
  modalTitle: { fontSize: 16, fontWeight: '700', color: T.textPrimary },
  modalClose: { fontSize: 14, color: T.accent, fontWeight: '500' },
  modalBody:  { padding: 20, paddingBottom: 36 },

  lbl:      { fontSize: 13, fontWeight: '500', color: T.textSec, marginBottom: 8, marginTop: 12 },
  inp:      { height: 48, backgroundColor: T.input, borderWidth: 1, borderColor: T.inputBorder, borderRadius: 10, paddingHorizontal: 14, fontSize: 15, color: T.textPrimary, marginBottom: 4 },
  iconOpt:  { width: 40, height: 40, borderRadius: 10, backgroundColor: T.screen, justifyContent: 'center', alignItems: 'center' },
  iconOptOn:{ borderWidth: 2, borderColor: T.accent, backgroundColor: T.accentSoft },
  err:      { color: T.red, fontSize: 13, marginTop: 6 },
  saveBtn:  { height: 50, backgroundColor: T.accent, borderRadius: R.control, justifyContent: 'center', alignItems: 'center', marginTop: 16 },
  saveBtnText:{ color: '#fff', fontSize: 15, fontWeight: '600' },

  confirmBg:         { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  confirmBox:        { backgroundColor: T.card, borderRadius: 20, padding: 24, width: '100%', maxWidth: 340 },
  confirmTitle:      { fontSize: 16, fontWeight: '700', color: T.textPrimary, marginBottom: 8 },
  confirmSub:        { fontSize: 13, color: T.textSec, lineHeight: 19, marginBottom: 20 },
  confirmBtns:       { flexDirection: 'row', gap: 10 },
  confirmCancel:     { flex: 1, height: 46, backgroundColor: T.screen, borderRadius: R.control, justifyContent: 'center', alignItems: 'center' },
  confirmCancelText: { fontSize: 14, color: T.textSec, fontWeight: '500' },
  confirmDanger:     { flex: 1, height: 46, backgroundColor: T.red, borderRadius: R.control, justifyContent: 'center', alignItems: 'center' },
  confirmDangerText: { fontSize: 14, color: '#fff', fontWeight: '600' },

  reglasTitulo: { fontSize: 14, fontWeight: '700', color: T.textPrimary, marginBottom: 4 },
  reglasHint:   { fontSize: 11, color: T.textMicro, marginBottom: 12, lineHeight: 16 },
  reglaRow:     {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: T.card, borderRadius: 12, borderWidth: 1, borderColor: T.border,
    padding: 12, marginBottom: 6,
  },
  reglaCom:  { fontSize: 13, fontWeight: '600', color: T.textPrimary },
  reglaCat:  { fontSize: 11, color: T.textMicro, marginTop: 2 },
});
