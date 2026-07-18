import { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, Modal, TextInput, ScrollView, Switch, Platform,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useCategorias, BASE_INCOME_CATS, iconForCat } from '@/hooks/useCategorias';
import { DatePickerInput } from '@/components/DatePickerInput';
import { T, MAXW } from '@/theme';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Tx {
  id: string;
  user_id: string;
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
  gastos_recurrentes_id: string | null;
  auto_clasificado: boolean | null;
  privado: boolean | null;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const PAGE = 50;
const SYM: Record<string, string> = {
  PEN: 'S/', USD: '$', EUR: '€', BRL: 'R$', COP: '$', MXN: '$', ARS: '$', CLP: '$',
};
const CURRENCIES = ['PEN', 'USD', 'EUR', 'BRL', 'COP', 'MXN', 'ARS', 'CLP'];


function normalizar(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '').replace(/\s+/g, ' ');
}

function getMesOptions() {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('es-PE', { month: 'long', year: 'numeric' });
    return { label: label.charAt(0).toUpperCase() + label.slice(1), value };
  });
}

// Labels cortos para la quick-bar
function getQuickChips() {
  const now = new Date();
  return [
    { label: 'Todo', value: 'all' },
    ...Array.from({ length: 3 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = i === 0
        ? 'Este mes'
        : d.toLocaleDateString('es-PE', { month: 'short' }).replace('.', '').charAt(0).toUpperCase()
          + d.toLocaleDateString('es-PE', { month: 'short' }).replace('.', '').slice(1);
      return { label, value };
    }),
  ];
}

function fmtTx(tx: Tx, fallbackCur: string) {
  const mon = tx.moneda ?? fallbackCur;
  return `${SYM[mon] ?? mon} ${Number(tx.monto).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TransactionsList({ vistaHogar = false }: { vistaHogar?: boolean }) {
  const now = new Date();
  const currentMes = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [userId,       setUserId]       = useState('');
  const [txs,          setTxs]          = useState<Tx[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [loadingMore,  setLoadingMore]  = useState(false);
  const [hasMore,      setHasMore]      = useState(true);
  const [page,         setPage]         = useState(0);
  const [currency,     setCurrency]     = useState('PEN');
  const [showInactive, setShowInactive] = useState(false);

  const { categorias: catGasto } = useCategorias();

  // ── Filter state ────────────────────────────────────────────────────────────
  const [showFilters,          setShowFilters]          = useState(false);
  const [searchText,           setSearchText]           = useState('');
  const [filterMes,            setFilterMes]            = useState(currentMes);
  const [filterMoneda,         setFilterMoneda]         = useState<string | null>(null);
  const [filterCat,            setFilterCat]            = useState<string | null>(null);
  const [filterSubcat,         setFilterSubcat]         = useState<string | null>(null);
  const [subcatsFilter,        setSubcatsFilter]        = useState<{ id: string; nombre: string }[]>([]);
  const [showMesPicker,        setShowMesPicker]        = useState(false);
  const [showFiltCatPicker,    setShowFiltCatPicker]    = useState(false);
  const [showFiltSubcatPicker, setShowFiltSubcatPicker] = useState(false);

  // ── Edit modal state ────────────────────────────────────────────────────────
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
  const [subcatsLoading,   setSubcatsLoading]   = useState(false);
  const [saving,           setSaving]           = useState(false);
  const [saveError,        setSaveError]        = useState('');

  // ── Actions bottom sheet state ──────────────────────────────────────────────
  const [actionTx,     setActionTx]     = useState<Tx | null>(null);

  // ── Deactivate state ────────────────────────────────────────────────────────
  const [confirmTx,    setConfirmTx]    = useState<Tx | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  // ── Convert to recurring state ──────────────────────────────────────────────
  const [recurTx,    setRecurTx]    = useState<Tx | null>(null);
  const [converting, setConverting] = useState(false);
  const [recurError, setRecurError] = useState('');

  // ── Data fetching ───────────────────────────────────────────────────────────

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !active) return;
        setUserId(user.id);
        const { data: prof } = await supabase.from('profiles').select('moneda_base').eq('id', user.id).single();
        if (active && prof) setCurrency((prof as any).moneda_base ?? 'PEN');
      })();
      setPage(0);
      fetchTxs(0, true, { mes: filterMes, inactive: false });
      return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  async function fetchTxs(
    pageNum: number,
    reset: boolean,
    opts: { mes?: string; inactive?: boolean } = {},
  ) {
    const mes      = opts.mes      ?? filterMes;
    const inactive = opts.inactive ?? showInactive;

    if (reset) setLoading(true); else setLoadingMore(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); setLoadingMore(false); return; }

    let q = supabase
      .from('transacciones')
      .select('id,user_id,tipo,monto,categoria,descripcion,metodo_pago,tarjeta_id,prestamo_id,cuenta_ahorro_id,activo,creado_en,fecha,moneda,es_gasto_unico,subcategoria_id,gastos_recurrentes_id,auto_clasificado,privado')
      .order('fecha', { ascending: false })
      .order('creado_en', { ascending: false })
      .range(pageNum * PAGE, (pageNum + 1) * PAGE - 1);

    // En vista hogar la RLS ya filtra; en vista personal filtramos explícitamente
    if (!vistaHogar) q = q.eq('user_id', user.id);

    if (!inactive) q = q.eq('activo', true);

    if (mes !== 'all') {
      const [y, m] = mes.split('-').map(Number);
      const start  = `${y}-${String(m).padStart(2, '0')}-01`;
      const end    = new Date(y, m, 1).toISOString().slice(0, 10);
      // Include transactions where fecha is in range OR fecha is null but creado_en is in range
      // (PostgreSQL excludes NULLs in comparisons, so null-fecha rows would vanish otherwise)
      q = q.or(
        `and(fecha.gte.${start},fecha.lt.${end}),` +
        `and(fecha.is.null,creado_en.gte.${start}T00:00:00,creado_en.lt.${end}T00:00:00)`,
      );
    }

    const { data } = await q;
    if (data) {
      setTxs(prev => reset ? (data as Tx[]) : [...prev, ...(data as Tx[])]);
      setHasMore((data as Tx[]).length === PAGE);
    }
    setLoading(false);
    setLoadingMore(false);
  }

  // ── In-memory filter ────────────────────────────────────────────────────────

  const filtered = txs.filter(tx => {
    if (searchText) {
      const q = searchText.toLowerCase();
      if (!tx.descripcion?.toLowerCase().includes(q) && !tx.categoria.toLowerCase().includes(q)) return false;
    }
    if (filterMoneda && (tx.moneda ?? 'PEN') !== filterMoneda) return false;
    if (filterCat && tx.categoria !== filterCat) return false;
    if (filterSubcat && tx.subcategoria_id !== filterSubcat) return false;
    return true;
  });

  type ListItem =
    | { type: 'header'; dateStr: string }
    | { type: 'tx'; tx: Tx; first: boolean; last: boolean };
  const grouped: ListItem[] = [];
  let lastDay = '';
  for (const tx of filtered) {
    const day = tx.fecha ?? tx.creado_en.slice(0, 10);
    if (day !== lastDay) { grouped.push({ type: 'header', dateStr: day }); lastDay = day; }
    grouped.push({ type: 'tx', tx, first: false, last: false });
  }
  // Marcar límites de cada grupo diario (para bordes redondeados del card agrupado)
  for (let i = 0; i < grouped.length; i++) {
    const it = grouped[i];
    if (it.type !== 'tx') continue;
    const prev = grouped[i - 1];
    const next = grouped[i + 1];
    it.first = !prev || prev.type === 'header';
    it.last  = !next || next.type === 'header';
  }

  const mesOptions  = getMesOptions();
  const quickChips  = getQuickChips();
  const activeFilters =
    (searchText ? 1 : 0) +
    (filterMoneda ? 1 : 0) +
    (filterCat ? 1 : 0) +
    (filterSubcat ? 1 : 0) +
    (filterMes !== currentMes ? 1 : 0) +
    (showInactive ? 1 : 0);

  // ── Filter helpers ──────────────────────────────────────────────────────────

  const onFilterCatChange = async (cat: string | null) => {
    setFilterCat(cat);
    setFilterSubcat(null);
    setSubcatsFilter([]);
    if (cat) {
      const { data } = await supabase.from('subcategorias').select('id,nombre').eq('categoria_nombre', cat).order('nombre');
      setSubcatsFilter((data ?? []) as { id: string; nombre: string }[]);
    }
  };

  const resetFilters = () => {
    setSearchText('');
    setFilterMes(currentMes);
    setFilterMoneda(null);
    setFilterCat(null);
    setFilterSubcat(null);
    setSubcatsFilter([]);
    setShowInactive(false);
    setPage(0);
    fetchTxs(0, true, { mes: currentMes, inactive: false });
  };

  // ── Edit helpers ────────────────────────────────────────────────────────────

  const loadSubcats = async (cat: string) => {
    setSubcatsLoading(true);
    const { data } = await supabase.from('subcategorias').select('id,nombre').eq('categoria_nombre', cat).order('nombre');
    setSubcats(data && data.length > 0 ? (data as { id: string; nombre: string }[]) : []);
    setSubcatsLoading(false);
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
    setEditFecha(tx.fecha ?? tx.creado_en.slice(0, 10));
    setSubcats([]);
    if (tx.tipo === 'gasto') loadSubcats(tx.categoria);
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaveError('');
    const m = parseFloat(editMonto.replace(',', '.'));
    if (isNaN(m) || m <= 0) { setSaveError('El monto debe ser un número mayor a 0.'); return; }
    if (!editFecha) { setSaveError('Selecciona una fecha.'); return; }
    const fechaParsed = editFecha;
    setSaving(true);
    if (editing.tipo === 'gasto' && editing.metodo_pago === 'tarjeta' && editing.tarjeta_id && m !== Number(editing.monto)) {
      const { data: tc } = await supabase.from('tarjetas_credito').select('deuda_actual').eq('id', editing.tarjeta_id).single();
      if (tc) {
        const nuevaDeuda = Math.max(0, Number((tc as any).deuda_actual) + (m - Number(editing.monto)));
        await supabase.from('tarjetas_credito').update({ deuda_actual: nuevaDeuda }).eq('id', editing.tarjeta_id);
      }
    }
    const updates: Record<string, unknown> = {
      monto: m, categoria: editCat, descripcion: editDesc.trim() || null,
      moneda: editMoneda, fecha: fechaParsed,
      ...(editing.tipo === 'gasto' ? { es_gasto_unico: editUnico, subcategoria_id: editSubcatId ?? null } : {}),
    };
    const { error } = await supabase.from('transacciones').update(updates).eq('id', editing.id);
    if (error) { setSaveError(`Error: ${error.message}`); setSaving(false); return; }

    // Aprender regla si el usuario corrigió la categoría de una tx auto-clasificada
    if (editing.auto_clasificado && editCat !== editing.categoria && editing.descripcion) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        supabase.from('reglas_categorizacion').upsert(
          { user_id: user.id, comercio_normalizado: normalizar(editing.descripcion), categoria: editCat },
          { onConflict: 'user_id,comercio_normalizado' },
        ).then(() => {});
      }
    }

    const savedId = editing.id;
    setTxs(prev => prev.map(t => t.id === savedId ? { ...t, ...updates } as Tx : t));
    setEditing(null);
    setSaving(false);
  };

  // ── Toggle ⚡ ───────────────────────────────────────────────────────────────

  const handleToggleUnico = async (tx: Tx) => {
    if (tx.tipo !== 'gasto') return;
    const newVal = !(tx.es_gasto_unico ?? false);
    const { error } = await supabase.from('transacciones').update({ es_gasto_unico: newVal }).eq('id', tx.id);
    if (!error) setTxs(prev => prev.map(t => t.id === tx.id ? { ...t, es_gasto_unico: newVal } : t));
  };

  // ── Deactivate ──────────────────────────────────────────────────────────────

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

  // ── Convert to recurring ────────────────────────────────────────────────────

  const handleConvertToRecurrente = async () => {
    if (!recurTx || !userId) return;
    setConverting(true); setRecurError('');
    const raw = recurTx.fecha ?? recurTx.creado_en.slice(0, 10);
    const d = new Date(raw + 'T12:00:00');
    const mesInicio = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    const { data: rec, error } = await supabase.from('gastos_recurrentes').insert({
      user_id:     userId,
      monto:       recurTx.monto,
      categoria:   recurTx.categoria,
      descripcion: recurTx.descripcion,
      dia_cobro:   d.getDate(),
      mes_inicio:  mesInicio,
    }).select('id').single();
    if (error || !rec) { setRecurError(error?.message ?? 'Error'); setConverting(false); return; }
    await supabase.from('transacciones')
      .update({ gastos_recurrentes_id: (rec as any).id, es_gasto_unico: false })
      .eq('id', recurTx.id);
    setTxs(prev => prev.map(t =>
      t.id === recurTx!.id
        ? { ...t, gastos_recurrentes_id: (rec as any).id, es_gasto_unico: false }
        : t
    ));
    setRecurTx(null);
    setConverting(false);
  };

  const subcatName = subcats.find(s => s.id === editSubcatId)?.nombre ?? null;
  const cats       = editing?.tipo === 'ingreso' ? BASE_INCOME_CATS : catGasto;
  const recurDay   = recurTx ? new Date((recurTx.fecha ?? recurTx.creado_en.slice(0, 10)) + 'T12:00:00').getDate() : 0;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <View style={s.root}>

      {/* ── Filter bar ── */}
      <View style={s.filterBar}>
        <View style={s.constrain}>
        <View style={s.filterBarRow}>
          <View style={s.searchWrap}>
            <Ionicons name="search" size={15} color={T.textMicro} style={{ marginRight: 7 }} />
            <TextInput
              style={s.searchInput}
              placeholder="Buscar por descripción o categoría…"
              placeholderTextColor={T.textMicro}
              value={searchText}
              onChangeText={setSearchText}
              clearButtonMode="while-editing"
            />
          </View>
          <TouchableOpacity
            style={[s.filterToggle, showFilters && s.filterToggleOn]}
            onPress={() => setShowFilters(v => !v)}
          >
            <Ionicons
              name="options-outline"
              size={17}
              color={showFilters ? T.accent : T.textSec}
            />
            {activeFilters > 0 && (
              <View style={s.filterCount}>
                <Text style={s.filterCountText}>{activeFilters}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {showFilters && (
          <View style={s.filterPanel}>
            {/* Mes */}
            <Text style={s.filtLabel}>Período</Text>
            <TouchableOpacity style={s.filtPicker} onPress={() => setShowMesPicker(true)}>
              <Text style={s.filtPickerText}>
                {filterMes === 'all'
                  ? 'Todos los meses'
                  : mesOptions.find(o => o.value === filterMes)?.label ?? filterMes}
              </Text>
              <Text style={s.filtChevron}>›</Text>
            </TouchableOpacity>

            {/* Moneda */}
            <Text style={s.filtLabel}>Moneda</Text>
            <View style={s.chipsRow}>
              {(['Todas', 'PEN', 'USD', 'EUR'] as const).map(m => {
                const val = m === 'Todas' ? null : m;
                const on  = filterMoneda === val;
                return (
                  <TouchableOpacity key={m} style={[s.chip, on && s.chipOn]} onPress={() => setFilterMoneda(val)}>
                    <Text style={[s.chipText, on && s.chipTextOn]}>{m}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Categoría */}
            <Text style={s.filtLabel}>Categoría</Text>
            <TouchableOpacity style={s.filtPicker} onPress={() => setShowFiltCatPicker(true)}>
              <Text style={filterCat ? s.filtPickerText : s.filtPickerPlaceholder}>
                {filterCat ? `${iconForCat(filterCat, catGasto)} ${filterCat}` : 'Todas las categorías'}
              </Text>
              <Text style={s.filtChevron}>›</Text>
            </TouchableOpacity>

            {/* Subcategoría */}
            {filterCat && subcatsFilter.length > 0 && (
              <>
                <Text style={s.filtLabel}>Subcategoría</Text>
                <TouchableOpacity style={s.filtPicker} onPress={() => setShowFiltSubcatPicker(true)}>
                  <Text style={filterSubcat ? s.filtPickerText : s.filtPickerPlaceholder}>
                    {filterSubcat
                      ? (subcatsFilter.find(x => x.id === filterSubcat)?.nombre ?? 'Seleccionar')
                      : 'Todas'}
                  </Text>
                  <Text style={s.filtChevron}>›</Text>
                </TouchableOpacity>
              </>
            )}

            {/* Mostrar anuladas */}
            <View style={s.switchFilt}>
              <Text style={s.filtLabel} >Mostrar anuladas</Text>
              <Switch
                value={showInactive}
                onValueChange={v => {
                  setShowInactive(v);
                  setPage(0);
                  fetchTxs(0, true, { inactive: v });
                }}
                trackColor={{ false: T.inputBorder, true: T.accentSoft }}
                thumbColor={showInactive ? T.accent : T.textMicro}
              />
            </View>

            {activeFilters > 0 && (
              <TouchableOpacity style={s.resetBtn} onPress={resetFilters}>
                <Text style={s.resetText}>Limpiar filtros</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        </View>
      </View>

      {/* ── Quick month chips ── */}
      <View style={s.chipBarWrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.chipBar}
        style={s.constrain}
      >
        {quickChips.map(chip => {
          const active = filterMes === chip.value;
          return (
            <TouchableOpacity
              key={chip.value}
              style={[s.qChip, active && s.qChipOn]}
              onPress={() => {
                if (filterMes === chip.value) return;
                setFilterMes(chip.value);
                setPage(0);
                fetchTxs(0, true, { mes: chip.value });
              }}
              activeOpacity={0.75}
            >
              <Text style={[s.qChipText, active && s.qChipTextOn]}>{chip.label}</Text>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity
          style={s.qChipMore}
          onPress={() => setShowFilters(v => !v)}
        >
          <Text style={s.qChipMoreText}>Más ›</Text>
        </TouchableOpacity>
      </ScrollView>
      </View>

      {/* ── List ── */}
      {loading ? (
        <ActivityIndicator color="#7C3AED" style={{ marginTop: 48 }} />
      ) : (
        <FlatList
          data={grouped}
          keyExtractor={(item, i) =>
            item.type === 'header' ? `h-${item.dateStr}-${i}` : item.tx.id
          }
          contentContainerStyle={[s.list, s.constrain]}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={{ fontSize: 36, marginBottom: 10 }}>💸</Text>
              <Text style={s.emptyTitle}>Sin movimientos</Text>
              <Text style={s.emptySub}>
                {activeFilters > 0
                  ? 'Prueba ajustando los filtros.'
                  : 'Registra tu primer movimiento desde el Dashboard.'}
              </Text>
            </View>
          }
          ListFooterComponent={
            hasMore ? (
              <TouchableOpacity
                style={s.loadMoreBtn}
                onPress={() => { const next = page + 1; setPage(next); fetchTxs(next, false); }}
                disabled={loadingMore}
              >
                {loadingMore
                  ? <ActivityIndicator color="#7C3AED" />
                  : <Text style={s.loadMoreText}>Cargar más</Text>}
              </TouchableOpacity>
            ) : null
          }
          renderItem={({ item }) => {
            if (item.type === 'header') {
              const d = new Date(item.dateStr + 'T12:00:00');
              return (
                <Text style={s.dayHeader}>
                  {d.toLocaleDateString('es-PE', {
                    weekday: 'short', day: '2-digit', month: 'short',
                  }).toUpperCase()}
                </Text>
              );
            }

            const tx = item.tx;
            const isGasto = tx.tipo === 'gasto';
            const esMia = tx.user_id === userId;
            const puedeEditar = !vistaHogar || esMia;

            return (
              <View style={[s.txCard, item.first && s.txFirst, item.last && s.txLast]}>
                {!item.first && <View style={s.txSep} />}
                <View style={[s.txRow, !tx.activo && s.txInactive]}>
                  <View style={s.txIconBox}>
                    <Text style={{ fontSize: 17 }}>{iconForCat(tx.categoria, catGasto)}</Text>
                  </View>

                  <View style={s.txBody}>
                    <View style={s.txTitleRow}>
                      <Text style={s.txDesc} numberOfLines={1}>
                        {tx.descripcion || tx.categoria}
                      </Text>
                      {tx.auto_clasificado && (
                        <View style={[s.badge, s.badgeAuto]}>
                          <Text style={s.badgeText}>✨</Text>
                        </View>
                      )}
                      {tx.es_gasto_unico && (
                        <View style={s.badge}>
                          <Text style={s.badgeText}>⚡</Text>
                        </View>
                      )}
                      {tx.gastos_recurrentes_id && (
                        <View style={[s.badge, s.badgeRec]}>
                          <Text style={s.badgeText}>🔄</Text>
                        </View>
                      )}
                      {esMia && tx.privado && (
                        <View style={[s.badge, s.badgePrivado]}>
                          <Text style={s.badgeText}>🔒</Text>
                        </View>
                      )}
                      {!tx.activo && (
                        <View style={[s.badge, s.badgeOff]}>
                          <Text style={[s.badgeText, { color: T.textMicro }]}>anulado</Text>
                        </View>
                      )}
                    </View>
                    <Text style={s.txMeta} numberOfLines={1}>
                      {tx.categoria}
                      {tx.moneda && tx.moneda !== 'PEN' ? ` · ${tx.moneda}` : ''}
                      {tx.metodo_pago === 'tarjeta' ? ' · 💳' : ''}
                    </Text>
                  </View>

                  <View style={s.txRight}>
                    <Text style={[s.txAmt, isGasto ? s.red : s.green]}>
                      {isGasto ? '−' : '+'}{fmtTx(tx, currency)}
                    </Text>
                    {tx.activo && puedeEditar && (
                      <TouchableOpacity
                        style={s.menuBtn}
                        onPress={() => setActionTx(tx)}
                        hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                      >
                        <Ionicons name="ellipsis-vertical" size={15} color={T.textMicro} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            );
          }}
        />
      )}

      {/* ══════════════════════════ MODALS ══════════════════════════ */}

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

              <Text style={s.lbl}>Monto</Text>
              <TextInput style={s.inp} keyboardType="decimal-pad" value={editMonto} onChangeText={setEditMonto} />

              {editing?.tipo === 'gasto' && (
                <View style={s.switchRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.switchLabel}>Gasto único ⚡</Text>
                    <Text style={s.switchSub}>No se usa en la proyección de fin de mes</Text>
                  </View>
                  <Switch
                    value={editUnico}
                    onValueChange={setEditUnico}
                    trackColor={{ false: '#E5E7EB', true: '#FEF08A' }}
                    thumbColor={editUnico ? '#F59E0B' : '#9CA3AF'}
                  />
                </View>
              )}

              <Text style={s.lbl}>Moneda</Text>
              <TouchableOpacity style={s.pickerRow} onPress={() => setShowMonedaPicker(true)}>
                <Text style={s.pickerText}>{SYM[editMoneda] ?? editMoneda} {editMoneda}</Text>
                <Text style={s.chevron}>›</Text>
              </TouchableOpacity>

              <Text style={s.lbl}>Fecha</Text>
              <DatePickerInput
                value={editFecha}
                onChange={setEditFecha}
                inputStyle={s.inp}
              />

              <Text style={s.lbl}>Categoría</Text>
              <TouchableOpacity style={s.pickerRow} onPress={() => setShowCatPicker(true)}>
                <Text style={s.pickerText}>{iconForCat(editCat, catGasto)} {editCat || 'Seleccionar'}</Text>
                <Text style={s.chevron}>›</Text>
              </TouchableOpacity>

              {editing?.tipo === 'gasto' && (
                <>
                  <Text style={s.lbl}>
                    Subcategoría <Text style={s.optional}>(opcional)</Text>
                  </Text>
                  {subcatsLoading ? (
                    <View style={[s.pickerRow, { justifyContent: 'center' }]}>
                      <ActivityIndicator size="small" color="#9CA3AF" />
                      <Text style={[s.placeholder, { marginLeft: 8 }]}>Cargando…</Text>
                    </View>
                  ) : subcats.length > 0 ? (
                    <TouchableOpacity style={s.pickerRow} onPress={() => setShowSubcatPicker(true)}>
                      <Text style={editSubcatId ? s.pickerText : s.placeholder}>
                        {editSubcatId ? (subcatName ?? 'Seleccionar') : 'Sin subcategoría'}
                      </Text>
                      <Text style={s.chevron}>›</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={[s.pickerRow, { opacity: 0.45 }]}>
                      <Text style={s.placeholder}>Sin subcategorías para esta categoría</Text>
                    </View>
                  )}
                </>
              )}

              <Text style={s.lbl}>Descripción</Text>
              <TextInput
                style={s.inp}
                value={editDesc}
                onChangeText={setEditDesc}
                placeholder="Opcional"
                placeholderTextColor="#9CA3AF"
              />

              {editing?.metodo_pago === 'tarjeta' && (
                <Text style={s.note}>
                  El ajuste de monto actualizará la deuda de la tarjeta automáticamente.
                </Text>
              )}

              {!!saveError && (
                <View style={s.errBox}><Text style={s.errText}>{saveError}</Text></View>
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
                <TouchableOpacity style={s.optRow} onPress={() => { setEditMoneda(code); setShowMonedaPicker(false); }}>
                  <Text style={s.optText}>{SYM[code]} {code}</Text>
                  {editMoneda === code && <Text style={s.checkMark}>✓</Text>}
                </TouchableOpacity>
                {i < CURRENCIES.length - 1 && <View style={s.optSep} />}
              </View>
            ))}
            <View style={{ height: 20 }} />
          </View>
        </View>
      </Modal>

      {/* ── Cat picker (edit) ── */}
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
                    setEditCat(cat.nombre); setEditSubcatId(null); setShowCatPicker(false);
                    if (editing?.tipo === 'gasto') await loadSubcats(cat.nombre);
                  }}
                >
                  <Text style={s.catText}>{cat.icono}  {cat.nombre}</Text>
                  {editCat === cat.nombre && <Text style={s.checkMark}>✓</Text>}
                </TouchableOpacity>
              ))}
              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Subcategoría picker (edit) ── */}
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
              {!editSubcatId && <Text style={s.checkMark}>✓</Text>}
            </TouchableOpacity>
            <View style={s.optSep} />
            {subcats.map((sc, i) => (
              <View key={sc.id}>
                <TouchableOpacity style={s.optRow} onPress={() => { setEditSubcatId(sc.id); setShowSubcatPicker(false); }}>
                  <Text style={s.optText}>{sc.nombre}</Text>
                  {editSubcatId === sc.id && <Text style={s.checkMark}>✓</Text>}
                </TouchableOpacity>
                {i < subcats.length - 1 && <View style={s.optSep} />}
              </View>
            ))}
            <View style={{ height: 20 }} />
          </View>
        </View>
      </Modal>

      {/* ── Mes picker ── */}
      <Modal visible={showMesPicker} animationType="slide" transparent>
        <View style={s.overlay}>
          <View style={[s.sheet, { maxHeight: '60%' }]}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle}>Período</Text>
              <TouchableOpacity onPress={() => setShowMesPicker(false)}>
                <Text style={s.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={s.optRow} onPress={() => {
              setFilterMes('all'); setShowMesPicker(false); setPage(0); fetchTxs(0, true, { mes: 'all' });
            }}>
              <Text style={s.optText}>Todos los meses</Text>
              {filterMes === 'all' && <Text style={s.checkMark}>✓</Text>}
            </TouchableOpacity>
            <View style={s.optSep} />
            {mesOptions.map((opt, i) => (
              <View key={opt.value}>
                <TouchableOpacity style={s.optRow} onPress={() => {
                  setFilterMes(opt.value); setShowMesPicker(false);
                  setPage(0); fetchTxs(0, true, { mes: opt.value });
                }}>
                  <Text style={s.optText}>{opt.label}</Text>
                  {filterMes === opt.value && <Text style={s.checkMark}>✓</Text>}
                </TouchableOpacity>
                {i < mesOptions.length - 1 && <View style={s.optSep} />}
              </View>
            ))}
            <View style={{ height: 20 }} />
          </View>
        </View>
      </Modal>

      {/* ── Cat picker (filter) ── */}
      <Modal visible={showFiltCatPicker} animationType="slide" transparent>
        <View style={s.overlay}>
          <View style={[s.sheet, { maxHeight: '75%' }]}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle}>Filtrar por categoría</Text>
              <TouchableOpacity onPress={() => setShowFiltCatPicker(false)}>
                <Text style={s.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              <TouchableOpacity style={s.catRow} onPress={() => { onFilterCatChange(null); setShowFiltCatPicker(false); }}>
                <Text style={s.catText}>📦  Todas las categorías</Text>
                {!filterCat && <Text style={s.checkMark}>✓</Text>}
              </TouchableOpacity>
              {catGasto.map(cat => (
                <TouchableOpacity key={cat.nombre} style={s.catRow}
                  onPress={() => { onFilterCatChange(cat.nombre); setShowFiltCatPicker(false); }}>
                  <Text style={s.catText}>{cat.icono}  {cat.nombre}</Text>
                  {filterCat === cat.nombre && <Text style={s.checkMark}>✓</Text>}
                </TouchableOpacity>
              ))}
              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Subcategoría picker (filter) ── */}
      <Modal visible={showFiltSubcatPicker} animationType="slide" transparent>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle}>Filtrar por subcategoría</Text>
              <TouchableOpacity onPress={() => setShowFiltSubcatPicker(false)}>
                <Text style={s.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={s.optRow} onPress={() => { setFilterSubcat(null); setShowFiltSubcatPicker(false); }}>
              <Text style={s.optText}>Todas</Text>
              {!filterSubcat && <Text style={s.checkMark}>✓</Text>}
            </TouchableOpacity>
            <View style={s.optSep} />
            {subcatsFilter.map((sc, i) => (
              <View key={sc.id}>
                <TouchableOpacity style={s.optRow} onPress={() => { setFilterSubcat(sc.id); setShowFiltSubcatPicker(false); }}>
                  <Text style={s.optText}>{sc.nombre}</Text>
                  {filterSubcat === sc.id && <Text style={s.checkMark}>✓</Text>}
                </TouchableOpacity>
                {i < subcatsFilter.length - 1 && <View style={s.optSep} />}
              </View>
            ))}
            <View style={{ height: 20 }} />
          </View>
        </View>
      </Modal>

      {/* ── Actions bottom sheet ── */}
      <Modal visible={!!actionTx} animationType="slide" transparent>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setActionTx(null)}>
          <View style={s.actionSheet}>
            <View style={s.actionPill} />
            <Text style={s.actionTitle} numberOfLines={1}>
              {actionTx?.descripcion || actionTx?.categoria || ''}
            </Text>
            <View style={s.optSep} />

            {actionTx?.tipo === 'gasto' && (
              <>
                <TouchableOpacity
                  style={s.actionOpt}
                  onPress={() => { handleToggleUnico(actionTx!); setActionTx(null); }}
                >
                  <View style={[s.actionOptIcon, { backgroundColor: actionTx?.es_gasto_unico ? '#FEF9C3' : '#F3F4F6' }]}>
                    <Text style={{ fontSize: 18 }}>⚡</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.actionOptTitle}>
                      {actionTx?.es_gasto_unico ? 'Quitar marca de único' : 'Marcar como único'}
                    </Text>
                    <Text style={s.actionOptSub}>No se proyecta al fin de mes</Text>
                  </View>
                </TouchableOpacity>
                <View style={s.optSep} />
              </>
            )}

            <TouchableOpacity
              style={s.actionOpt}
              onPress={() => { openEdit(actionTx!); setActionTx(null); }}
            >
              <View style={[s.actionOptIcon, { backgroundColor: '#EFF6FF' }]}>
                <Text style={{ fontSize: 18 }}>✎</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.actionOptTitle}>Editar</Text>
                <Text style={s.actionOptSub}>Monto, fecha, categoría…</Text>
              </View>
            </TouchableOpacity>

            {actionTx?.tipo === 'gasto' && !actionTx?.gastos_recurrentes_id && (
              <>
                <View style={s.optSep} />
                <TouchableOpacity
                  style={s.actionOpt}
                  onPress={() => { setRecurError(''); setRecurTx(actionTx!); setActionTx(null); }}
                >
                  <View style={[s.actionOptIcon, { backgroundColor: '#D1FAE5' }]}>
                    <Text style={{ fontSize: 18 }}>🔄</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.actionOptTitle}>Convertir en recurrente</Text>
                    <Text style={s.actionOptSub}>Se repetirá cada mes</Text>
                  </View>
                </TouchableOpacity>
              </>
            )}

            <View style={s.optSep} />
            <TouchableOpacity
              style={s.actionOpt}
              onPress={() => { setConfirmTx(actionTx!); setActionTx(null); }}
            >
              <View style={[s.actionOptIcon, { backgroundColor: '#FEF2F2' }]}>
                <Text style={{ fontSize: 18 }}>✕</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.actionOptTitle, { color: '#DC2626' }]}>Anular transacción</Text>
                <Text style={s.actionOptSub}>Se excluirá del balance</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={s.actionCancel} onPress={() => setActionTx(null)}>
              <Text style={s.actionCancelText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Confirm deactivate ── */}
      <Modal visible={!!confirmTx} animationType="fade" transparent>
        <View style={s.confirmBg}>
          <View style={s.confirmBox}>
            <Text style={s.confirmTitle}>¿Desactivar transacción?</Text>
            <Text style={s.confirmSub}>
              Se marcará como inactiva y se excluirá del balance.
              {confirmTx?.metodo_pago === 'tarjeta'
                ? ' La deuda de la tarjeta se reducirá automáticamente.' : ''}
            </Text>
            <View style={s.confirmBtns}>
              <TouchableOpacity style={s.confirmCancel} onPress={() => setConfirmTx(null)}>
                <Text style={s.confirmCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.confirmDanger, deactivating && s.btnOff]}
                onPress={handleDeactivate}
                disabled={deactivating}
              >
                {deactivating
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.confirmDangerText}>Desactivar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Convert to recurring ── */}
      <Modal visible={!!recurTx} animationType="fade" transparent>
        <View style={s.confirmBg}>
          <View style={s.confirmBox}>
            <Text style={s.confirmTitle}>🔄 Convertir en Recurrente</Text>
            <Text style={s.confirmSub}>
              {'Se creará un gasto recurrente mensual de\n'}
              <Text style={{ fontWeight: '700', color: '#111827' }}>
                {recurTx
                  ? `${SYM[recurTx.moneda ?? 'PEN'] ?? ''} ${Number(recurTx.monto).toFixed(2)} · ${recurTx.descripcion ?? recurTx.categoria}`
                  : ''}
              </Text>
              {`\n\nCobro mensual el día `}
              <Text style={{ fontWeight: '700' }}>{recurDay}.</Text>
              {'\nEsta transacción quedará vinculada como "Aplicada" en Compromisos Fijos.'}
            </Text>
            {!!recurError && (
              <View style={s.errBox}><Text style={s.errText}>{recurError}</Text></View>
            )}
            <View style={s.confirmBtns}>
              <TouchableOpacity style={s.confirmCancel} onPress={() => setRecurTx(null)}>
                <Text style={s.confirmCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.confirmSave, converting && s.btnOff]}
                onPress={handleConvertToRecurrente}
                disabled={converting}
              >
                {converting
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.confirmSaveText}>Confirmar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:      { flex: 1, backgroundColor: T.screen },
  // Contenedor de ancho máximo: evita que la UI se estire en web/tablet
  constrain: { width: '100%', maxWidth: MAXW, alignSelf: 'center' },

  // ── Barra de búsqueda + filtros
  filterBar:    { backgroundColor: T.card, borderBottomWidth: 1, borderBottomColor: T.border, paddingHorizontal: 16, paddingVertical: 10 },
  filterBarRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  searchWrap:   {
    flex: 1, height: 40, flexDirection: 'row', alignItems: 'center',
    backgroundColor: T.input, borderWidth: 1, borderColor: T.inputBorder,
    borderRadius: 12, paddingHorizontal: 12,
  },
  searchInput:  { flex: 1, height: '100%', fontSize: 14, color: T.textPrimary, paddingVertical: 0 },
  filterToggle: {
    height: 40, minWidth: 40, paddingHorizontal: 10, flexDirection: 'row', gap: 5,
    backgroundColor: T.input, borderWidth: 1, borderColor: T.inputBorder,
    borderRadius: 12, justifyContent: 'center', alignItems: 'center',
  },
  filterToggleOn:  { backgroundColor: T.accentSoft, borderColor: T.accent },
  // (legacy — ya no se usan tras migrar a Ionicons, se conservan por compatibilidad)
  filterToggleText:   { fontSize: 14, color: T.textSec, fontWeight: '600' },
  filterToggleTextOn: { color: T.accent },
  filterCount:     {
    minWidth: 17, height: 17, borderRadius: 9, backgroundColor: T.accent,
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4,
  },
  filterCountText: { fontSize: 10, fontWeight: '700', color: '#fff' },

  filterPanel: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: T.border },
  filtLabel:   { fontSize: 10, fontWeight: '600', color: T.textMicro, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6, marginTop: 8 },
  filtPicker:  {
    height: 42, backgroundColor: T.input, borderWidth: 1, borderColor: T.inputBorder,
    borderRadius: 12, paddingHorizontal: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  filtPickerText:        { fontSize: 14, color: T.textPrimary },
  filtPickerPlaceholder: { fontSize: 14, color: T.textMicro },
  filtChevron:           { fontSize: 18, color: T.textMicro },
  chipsRow:    { flexDirection: 'row', gap: 8 },
  chip:        { paddingHorizontal: 14, paddingVertical: 7, backgroundColor: T.screen, borderRadius: 20, borderWidth: 1, borderColor: 'transparent' },
  chipOn:      { backgroundColor: T.accentSoft, borderColor: T.accent },
  chipText:    { fontSize: 13, color: T.textSec, fontWeight: '500' },
  chipTextOn:  { color: T.accentDark, fontWeight: '700' },
  switchFilt:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  resetBtn:    { marginTop: 12, alignItems: 'center', paddingVertical: 10, backgroundColor: T.redSoft, borderRadius: 12 },
  resetText:   { fontSize: 13, color: T.red, fontWeight: '600' },

  // ── Barra de chips de mes
  chipBarWrap:  { backgroundColor: T.card, borderBottomWidth: 1, borderBottomColor: T.border },
  chipBar:      { paddingHorizontal: 16, paddingVertical: 10, gap: 8, flexDirection: 'row' },
  qChip:        { paddingHorizontal: 14, paddingVertical: 7, backgroundColor: T.screen, borderRadius: 20, borderWidth: 1.5, borderColor: 'transparent' },
  qChipOn:      { backgroundColor: T.accentSoft, borderColor: T.accent },
  qChipText:    { fontSize: 13, fontWeight: '600', color: T.textSec },
  qChipTextOn:  { color: T.accentDark },
  qChipMore:    { paddingHorizontal: 14, paddingVertical: 7, backgroundColor: T.screen, borderRadius: 20 },
  qChipMoreText:{ fontSize: 13, fontWeight: '600', color: T.accent },

  // ── Lista
  list:      { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 32 },
  dayHeader: {
    fontSize: 10, fontWeight: '700', color: T.textMicro,
    letterSpacing: 1, paddingTop: 14, paddingBottom: 8, paddingLeft: 4,
  },

  // ── Card agrupada por día (mismo lenguaje que el Dashboard: hairline, radio 18, sin sombras)
  txCard:  { backgroundColor: T.card, borderLeftWidth: 1, borderRightWidth: 1, borderColor: T.border },
  txFirst: { borderTopWidth: 1, borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  txLast:  { borderBottomWidth: 1, borderBottomLeftRadius: 18, borderBottomRightRadius: 18 },
  txSep:   { height: 1, backgroundColor: T.border, marginLeft: 62 },
  txRow:   { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13 },
  txInactive: { opacity: 0.45 },

  txIconBox: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: T.screen,
    justifyContent: 'center', alignItems: 'center', marginRight: 12, flexShrink: 0,
  },
  txBody:     { flex: 1, minWidth: 0 },
  txTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2 },
  txDesc:     { fontSize: 14, fontWeight: '600', color: T.textPrimary, flexShrink: 1 },
  txMeta:     { fontSize: 11, color: T.textMicro },
  txRight:    { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 8, flexShrink: 0 },
  txAmt:      { fontSize: 14, fontWeight: '700', letterSpacing: -0.2 },
  menuBtn:    { width: 28, height: 28, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  green:      { color: T.green },
  red:        { color: T.red },

  badge:     { borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, backgroundColor: T.amberSoft, flexShrink: 0 },
  badgeAuto:    { backgroundColor: T.accentSoft },
  badgeRec:     { backgroundColor: T.greenSoft },
  badgeOff:     { backgroundColor: T.screen },
  badgePrivado: { backgroundColor: T.amberSoft },
  badgeText: { fontSize: 9, fontWeight: '700', color: T.amber },

  // (legacy — conservados por compatibilidad con vistas antiguas)
  iconBtn:     { width: 32, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  iconBtnMenu: { fontSize: 16, color: T.textSec, fontWeight: '700', letterSpacing: 2, lineHeight: 20 },
  iconBtnGray: { backgroundColor: T.screen },

  // ── Action sheet
  actionSheet:     { backgroundColor: T.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: Platform.OS === 'ios' ? 36 : 16, width: '100%', maxWidth: MAXW },
  actionPill:      { width: 36, height: 4, backgroundColor: T.inputBorder, borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 6 },
  actionTitle:     { fontSize: 13, fontWeight: '600', color: T.textSec, paddingHorizontal: 20, paddingVertical: 10 },
  actionOpt:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 14 },
  actionOptIcon:   { width: 42, height: 42, borderRadius: 12, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  actionOptTitle:  { fontSize: 15, fontWeight: '500', color: T.textPrimary },
  actionOptSub:    { fontSize: 12, color: T.textMicro, marginTop: 1 },
  actionCancel:    { margin: 14, marginTop: 8, backgroundColor: T.screen, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  actionCancelText:{ fontSize: 15, fontWeight: '600', color: T.textSec },

  // ── Cargar más / vacío
  loadMoreBtn:  { alignItems: 'center', paddingVertical: 15, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 18, marginTop: 10 },
  loadMoreText: { fontSize: 14, color: T.accent, fontWeight: '600' },
  empty:      { alignItems: 'center', paddingTop: 48 },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: T.textPrimary, marginBottom: 6 },
  emptySub:   { fontSize: 13, color: T.textMicro, textAlign: 'center', lineHeight: 19, paddingHorizontal: 32 },

  // ── Modal de edición
  overlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end', alignItems: 'center' },
  sheet:      { backgroundColor: T.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, width: '100%', maxWidth: MAXW, maxHeight: '90%', paddingHorizontal: 24 },
  sheetHead:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 20, paddingBottom: 16 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: T.textPrimary },
  closeBtn:   { fontSize: 18, color: T.textMicro, padding: 4 },
  lbl:        { fontSize: 13, fontWeight: '500', color: T.textSec, marginBottom: 6 },
  optional:   { fontWeight: '400', color: T.textMicro },
  inp:        { height: 48, backgroundColor: T.input, borderWidth: 1, borderColor: T.inputBorder, borderRadius: 12, paddingHorizontal: 14, fontSize: 15, color: T.textPrimary, marginBottom: 14 },
  pickerRow:  { height: 48, backgroundColor: T.input, borderWidth: 1, borderColor: T.inputBorder, borderRadius: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  pickerText: { fontSize: 15, color: T.textPrimary },
  placeholder:{ fontSize: 15, color: T.textMicro },
  chevron:    { fontSize: 20, color: T.textMicro },
  switchRow:  { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderTopWidth: 1, borderTopColor: T.border, marginBottom: 4 },
  switchLabel:{ fontSize: 15, fontWeight: '500', color: T.textPrimary },
  switchSub:  { fontSize: 11, color: T.textMicro, marginTop: 2 },
  note:       { fontSize: 12, color: '#0891B2', marginBottom: 14, lineHeight: 17 },
  errBox:     { backgroundColor: T.redSoft, borderRadius: 12, padding: 12, marginBottom: 12 },
  errText:    { color: T.red, fontSize: 13, lineHeight: 18 },
  rowBtns:    { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn:  { flex: 1, height: 48, backgroundColor: T.screen, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  cancelText: { fontSize: 15, color: T.textSec, fontWeight: '500' },
  saveBtn:    { flex: 1, height: 48, backgroundColor: T.accent, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  saveBtnText:{ fontSize: 15, color: '#fff', fontWeight: '600' },
  btnOff:     { opacity: 0.6 },
  optRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14 },
  optText:    { fontSize: 15, color: T.textPrimary },
  optSep:     { height: 1, backgroundColor: T.border },
  catRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: T.border },
  catText:    { fontSize: 15, color: T.textPrimary },
  checkMark:  { fontSize: 16, color: T.accent, fontWeight: '600' },

  // ── Diálogos de confirmación
  confirmBg:         { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  confirmBox:        { backgroundColor: T.card, borderRadius: 20, padding: 24, width: '100%', maxWidth: 360 },
  confirmTitle:      { fontSize: 16, fontWeight: '700', color: T.textPrimary, marginBottom: 10 },
  confirmSub:        { fontSize: 13, color: T.textSec, lineHeight: 20, marginBottom: 20 },
  confirmBtns:       { flexDirection: 'row', gap: 10 },
  confirmCancel:     { flex: 1, height: 46, backgroundColor: T.screen, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  confirmCancelText: { fontSize: 14, color: T.textSec, fontWeight: '500' },
  confirmDanger:     { flex: 1, height: 46, backgroundColor: T.red, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  confirmDangerText: { fontSize: 14, color: '#fff', fontWeight: '600' },
  confirmSave:       { flex: 1, height: 46, backgroundColor: T.green, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  confirmSaveText:   { fontSize: 14, color: '#fff', fontWeight: '600' },
});
