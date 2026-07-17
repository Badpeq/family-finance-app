import { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Modal, TextInput, Platform, SafeAreaView,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useCategorias, iconForCat } from '@/hooks/useCategorias';
import { T, R, MAXW } from '@/theme';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Recurrente {
  id: string;
  monto: number;
  categoria: string;
  descripcion: string | null;
  dia_cobro: number;
  mes_inicio: string;
  mes_fin: string | null;
}

interface Cuota {
  id: string;
  descripcion: string;
  categoria: string;
  monto_total: number;
  total_cuotas: number;
  monto_cuota: number;
  dia_cobro: number;
  mes_inicio: string;
  metodo_pago: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SYM: Record<string, string> = { PEN: 'S/', USD: '$', EUR: '€', BRL: 'R$', COP: '$', MXN: '$', ARS: '$', CLP: '$' };

function cuotaActual(mesInicioStr: string): number {
  const now = new Date();
  const ini = new Date(mesInicioStr + 'T12:00:00');
  return (now.getFullYear() - ini.getFullYear()) * 12 + now.getMonth() - ini.getMonth() + 1;
}

function cuotasRestantes(c: Cuota): number {
  return Math.max(c.total_cuotas - cuotaActual(c.mes_inicio), 0);
}

function deudaPendiente(c: Cuota): number {
  return c.monto_cuota * cuotasRestantes(c);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function GestionarDeudas() {
  const [currency,     setCurrency]     = useState('PEN');
  const [recurrentes,  setRecurrentes]  = useState<Recurrente[]>([]);
  const [cuotas,       setCuotas]       = useState<Cuota[]>([]);
  const [loading,      setLoading]      = useState(true);

  const { categorias: catList } = useCategorias();

  // ── Edit Recurrente ──
  const [editRec,          setEditRec]          = useState<Recurrente | null>(null);
  const [recMonto,         setRecMonto]         = useState('');
  const [recDesc,          setRecDesc]          = useState('');
  const [recCat,           setRecCat]           = useState('');
  const [recDia,           setRecDia]           = useState('');
  const [recMesFin,        setRecMesFin]        = useState('');
  const [showRecCatPicker, setShowRecCatPicker] = useState(false);
  const [savingRec,        setSavingRec]        = useState(false);
  const [recError,         setRecError]         = useState('');

  // ── Delete Recurrente ──
  const [confirmRec,    setConfirmRec]    = useState<Recurrente | null>(null);
  const [deletingRec,   setDeletingRec]   = useState(false);

  // ── Edit Cuota ──
  const [editCuota,          setEditCuota]          = useState<Cuota | null>(null);
  const [cuotaDesc,          setCuotaDesc]          = useState('');
  const [cuotaCat,           setCuotaCat]           = useState('');
  const [cuotaMontoCuota,    setCuotaMontoCuota]    = useState('');
  const [cuotaTotal,         setCuotaTotal]         = useState('');
  const [cuotaDia,           setCuotaDia]           = useState('');
  const [showCuotaCatPicker, setShowCuotaCatPicker] = useState(false);
  const [savingCuota,        setSavingCuota]        = useState(false);
  const [cuotaError,         setCuotaError]         = useState('');

  // ── Delete Cuota ──
  const [confirmCuota,  setConfirmCuota]  = useState<Cuota | null>(null);
  const [deletingCuota, setDeletingCuota] = useState(false);

  // ── Data fetch ────────────────────────────────────────────────────────────

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !active) return;
        const [profRes, recRes, cuotaRes] = await Promise.all([
          supabase.from('profiles').select('moneda_base').eq('id', user.id).single(),
          supabase.from('gastos_recurrentes')
            .select('id,monto,categoria,descripcion,dia_cobro,mes_inicio,mes_fin')
            .eq('user_id', user.id)
            .order('dia_cobro'),
          supabase.from('compras_cuotas')
            .select('id,descripcion,categoria,monto_total,total_cuotas,monto_cuota,dia_cobro,mes_inicio,metodo_pago')
            .eq('user_id', user.id)
            .order('mes_inicio', { ascending: false }),
        ]);
        if (!active) return;
        if (profRes.data) setCurrency((profRes.data as any).moneda_base ?? 'PEN');
        setRecurrentes((recRes.data ?? []) as Recurrente[]);
        setCuotas((cuotaRes.data ?? []) as Cuota[]);
        setLoading(false);
      })();
      return () => { active = false; };
    }, [])
  );

  const sym = SYM[currency] ?? currency;
  const fmt = (n: number) => `${sym} ${Number(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // ── Summary calculations ──────────────────────────────────────────────────

  const now = new Date();
  const activeRec  = recurrentes.filter(r => !r.mes_fin || new Date(r.mes_fin + 'T12:00:00') > now);
  const activeCuotas = cuotas.filter(c => cuotasRestantes(c) > 0);

  const costoMensualRec    = activeRec.reduce((s, r) => s + Number(r.monto), 0);
  const totalDeudaCuotas   = activeCuotas.reduce((s, c) => s + deudaPendiente(c), 0);
  const totalDeudaGlobal   = totalDeudaCuotas; // Recurrentes no tienen deuda finita

  // ── Recurrente CRUD ───────────────────────────────────────────────────────

  const openEditRec = (r: Recurrente) => {
    setRecError('');
    setEditRec(r);
    setRecMonto(String(r.monto));
    setRecDesc(r.descripcion ?? '');
    setRecCat(r.categoria);
    setRecDia(String(r.dia_cobro));
    setRecMesFin(r.mes_fin ?? '');
  };

  const handleSaveRec = async () => {
    if (!editRec) return;
    setRecError('');
    const monto = parseFloat(recMonto.replace(',', '.'));
    if (isNaN(monto) || monto <= 0) { setRecError('El monto debe ser mayor a 0.'); return; }
    const dia = parseInt(recDia, 10);
    if (isNaN(dia) || dia < 1 || dia > 31) { setRecError('El día de cobro debe estar entre 1 y 31.'); return; }
    let mesFin: string | null = null;
    if (recMesFin.trim()) {
      if (!/^\d{4}-\d{2}$/.test(recMesFin.trim())) { setRecError('Mes fin debe tener formato AAAA-MM.'); return; }
      mesFin = recMesFin.trim() + '-01';
    }
    setSavingRec(true);
    const { error } = await supabase.from('gastos_recurrentes').update({
      monto, categoria: recCat, descripcion: recDesc.trim() || null,
      dia_cobro: dia, mes_fin: mesFin,
    }).eq('id', editRec.id);
    if (error) { setRecError(error.message); setSavingRec(false); return; }
    setRecurrentes(prev => prev.map(r =>
      r.id === editRec.id
        ? { ...r, monto, categoria: recCat, descripcion: recDesc.trim() || null, dia_cobro: dia, mes_fin: mesFin }
        : r
    ));
    setEditRec(null);
    setSavingRec(false);
  };

  const handleDeleteRec = async () => {
    if (!confirmRec) return;
    setDeletingRec(true);
    await supabase.from('gastos_recurrentes').delete().eq('id', confirmRec.id);
    setRecurrentes(prev => prev.filter(r => r.id !== confirmRec.id));
    setConfirmRec(null);
    setDeletingRec(false);
  };

  // ── Cuota CRUD ────────────────────────────────────────────────────────────

  const openEditCuota = (c: Cuota) => {
    setCuotaError('');
    setEditCuota(c);
    setCuotaDesc(c.descripcion);
    setCuotaCat(c.categoria);
    setCuotaMontoCuota(String(c.monto_cuota));
    setCuotaTotal(String(c.total_cuotas));
    setCuotaDia(String(c.dia_cobro));
  };

  const handleSaveCuota = async () => {
    if (!editCuota) return;
    setCuotaError('');
    const mc    = parseFloat(cuotaMontoCuota.replace(',', '.'));
    const total = parseInt(cuotaTotal, 10);
    const dia   = parseInt(cuotaDia, 10);
    if (isNaN(mc) || mc <= 0)          { setCuotaError('El monto de cuota debe ser mayor a 0.'); return; }
    if (isNaN(total) || total < 1)     { setCuotaError('El total de cuotas debe ser al menos 1.'); return; }
    if (isNaN(dia) || dia < 1 || dia > 31) { setCuotaError('El día de cobro debe estar entre 1 y 31.'); return; }
    setSavingCuota(true);
    const { error } = await supabase.from('compras_cuotas').update({
      descripcion: cuotaDesc.trim(), categoria: cuotaCat,
      monto_cuota: mc, total_cuotas: total, dia_cobro: dia,
      monto_total: mc * total,
    }).eq('id', editCuota.id);
    if (error) { setCuotaError(error.message); setSavingCuota(false); return; }
    setCuotas(prev => prev.map(c =>
      c.id === editCuota.id
        ? { ...c, descripcion: cuotaDesc.trim(), categoria: cuotaCat, monto_cuota: mc, total_cuotas: total, dia_cobro: dia, monto_total: mc * total }
        : c
    ));
    setEditCuota(null);
    setSavingCuota(false);
  };

  const handleDeleteCuota = async () => {
    if (!confirmCuota) return;
    setDeletingCuota(true);
    await supabase.from('compras_cuotas').delete().eq('id', confirmCuota.id);
    setCuotas(prev => prev.filter(c => c.id !== confirmCuota.id));
    setConfirmCuota(null);
    setDeletingCuota(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>‹ Volver</Text>
        </TouchableOpacity>
        <Text style={s.title}>Gestionar Deudas</Text>
        <View style={{ width: 70 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={T.accent} style={{ marginTop: 48 }} />
      ) : (
        <ScrollView contentContainerStyle={s.scroll}>

          {/* ── Resumen global ── */}
          <View style={s.summaryCard}>
            <Text style={s.summaryTitle}>Resumen de obligaciones</Text>
            <View style={s.summaryRow}>
              <View style={s.summaryCol}>
                <Text style={s.summaryAmt}>{fmt(costoMensualRec)}</Text>
                <Text style={s.summaryLabel}>Costo mensual</Text>
                <Text style={s.summarySub}>recurrentes activos</Text>
              </View>
              <View style={s.summaryDivider} />
              <View style={s.summaryCol}>
                <Text style={[s.summaryAmt, { color: T.red }]}>{fmt(totalDeudaGlobal)}</Text>
                <Text style={s.summaryLabel}>Deuda total</Text>
                <Text style={s.summarySub}>cuotas pendientes</Text>
              </View>
            </View>
          </View>

          {/* ── Gastos Recurrentes ── */}
          <View style={s.sectionHead}>
            <Text style={s.sectionTitle}>🔄 Gastos Recurrentes</Text>
            <Text style={s.sectionCount}>{activeRec.length} activo{activeRec.length !== 1 ? 's' : ''}</Text>
          </View>

          {recurrentes.length === 0 ? (
            <View style={s.emptyBox}>
              <Text style={s.emptyText}>Sin gastos recurrentes registrados.</Text>
            </View>
          ) : (
            recurrentes.map(r => {
              const isActive = !r.mes_fin || new Date(r.mes_fin + 'T12:00:00') > now;
              return (
                <View key={r.id} style={[s.card, !isActive && s.cardInactive]}>
                  <View style={s.cardIcon}>
                    <Text style={{ fontSize: 17 }}>{iconForCat(r.categoria, catList)}</Text>
                  </View>
                  <View style={s.cardBody}>
                    <Text style={s.cardName} numberOfLines={1}>{r.descripcion ?? r.categoria}</Text>
                    <Text style={s.cardMeta}>
                      {r.categoria} · Día {r.dia_cobro} de cada mes
                      {r.mes_fin ? ` · Hasta ${r.mes_fin.slice(0, 7)}` : ''}
                    </Text>
                  </View>
                  <View style={s.cardRight}>
                    <Text style={s.cardAmt}>{fmt(r.monto)}</Text>
                    <Text style={s.cardAmtSub}>/ mes</Text>
                  </View>
                  <View style={s.cardActions}>
                    <TouchableOpacity style={s.actionBtn} onPress={() => openEditRec(r)}>
                      <Text style={s.actionEdit}>✎</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.actionBtn, s.actionBtnRed]} onPress={() => setConfirmRec(r)}>
                      <Text style={s.actionDelete}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}

          {/* ── Compras en Cuotas ── */}
          <View style={[s.sectionHead, { marginTop: 24 }]}>
            <Text style={s.sectionTitle}>📅 Compras en Cuotas</Text>
            <Text style={s.sectionCount}>{activeCuotas.length} pendiente{activeCuotas.length !== 1 ? 's' : ''}</Text>
          </View>

          {cuotas.length === 0 ? (
            <View style={s.emptyBox}>
              <Text style={s.emptyText}>Sin compras en cuotas registradas.</Text>
            </View>
          ) : (
            cuotas.map(c => {
              const restantes = cuotasRestantes(c);
              const pendiente = deudaPendiente(c);
              const actual    = cuotaActual(c.mes_inicio);
              const pct       = Math.min(actual / c.total_cuotas, 1);
              const finished  = restantes === 0;
              return (
                <View key={c.id} style={[s.card, finished && s.cardInactive]}>
                  <View style={s.cardIcon}>
                    <Text style={{ fontSize: 17 }}>{iconForCat(c.categoria, catList)}</Text>
                  </View>
                  <View style={s.cardBody}>
                    <Text style={s.cardName} numberOfLines={1}>{c.descripcion}</Text>
                    <Text style={s.cardMeta}>
                      {c.categoria} · Cuota {Math.min(actual, c.total_cuotas)}/{c.total_cuotas} · Día {c.dia_cobro}
                    </Text>
                    {/* Progress bar */}
                    <View style={s.progressBg}>
                      <View style={[s.progressFill, {
                        width: `${Math.round(pct * 100)}%` as any,
                        backgroundColor: finished ? T.textMicro : T.accent,
                      }]} />
                    </View>
                    {/* Deuda pendiente */}
                    {!finished && (
                      <Text style={s.deudaTag}>
                        Deuda pendiente: <Text style={s.deudaAmt}>{fmt(pendiente)}</Text>
                        {' '}({restantes} cuota{restantes !== 1 ? 's' : ''} × {fmt(c.monto_cuota)})
                      </Text>
                    )}
                    {finished && <Text style={s.finishedTag}>✓ Cuotas completadas</Text>}
                  </View>
                  <View style={s.cardActions}>
                    <TouchableOpacity style={s.actionBtn} onPress={() => openEditCuota(c)}>
                      <Text style={s.actionEdit}>✎</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.actionBtn, s.actionBtnRed]} onPress={() => setConfirmCuota(c)}>
                      <Text style={s.actionDelete}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* ════════════ MODALS ════════════ */}

      {/* ── Edit Recurrente ── */}
      <Modal visible={!!editRec} animationType="slide" transparent>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle}>Editar Recurrente</Text>
              <TouchableOpacity onPress={() => setEditRec(null)}>
                <Text style={s.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

              <Text style={s.lbl}>Monto mensual</Text>
              <TextInput style={s.inp} keyboardType="decimal-pad" value={recMonto} onChangeText={setRecMonto} />

              <Text style={s.lbl}>Categoría</Text>
              <TouchableOpacity style={s.pickerRow} onPress={() => setShowRecCatPicker(true)}>
                <Text style={s.pickerText}>{iconForCat(recCat, catList)} {recCat || 'Seleccionar'}</Text>
                <Text style={s.chevron}>›</Text>
              </TouchableOpacity>

              <Text style={s.lbl}>Descripción</Text>
              <TextInput style={s.inp} value={recDesc} onChangeText={setRecDesc}
                placeholder="Opcional" placeholderTextColor={T.textMicro} />

              <Text style={s.lbl}>Día de cobro (1–31)</Text>
              <TextInput style={s.inp} keyboardType="number-pad" value={recDia} onChangeText={setRecDia} />

              <Text style={s.lbl}>
                Mes de finalización <Text style={s.optional}>(opcional — formato AAAA-MM)</Text>
              </Text>
              <TextInput style={s.inp} value={recMesFin} onChangeText={setRecMesFin}
                placeholder="Ej: 2025-12" placeholderTextColor={T.textMicro} keyboardType="numeric" />
              <Text style={s.hint}>Deja vacío si el gasto no tiene fecha de fin.</Text>

              {!!recError && <View style={s.errBox}><Text style={s.errText}>{recError}</Text></View>}

              <View style={s.rowBtns}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setEditRec(null)}>
                  <Text style={s.cancelText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.saveBtn, savingRec && s.btnOff]} onPress={handleSaveRec} disabled={savingRec}>
                  {savingRec ? <ActivityIndicator color="#fff" /> : <Text style={s.saveBtnText}>Guardar</Text>}
                </TouchableOpacity>
              </View>
              <View style={{ height: 24 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Cat picker (recurrente) ── */}
      <Modal visible={showRecCatPicker} animationType="slide" transparent>
        <View style={s.overlay}>
          <View style={[s.sheet, { maxHeight: '70%' }]}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle}>Categoría</Text>
              <TouchableOpacity onPress={() => setShowRecCatPicker(false)}>
                <Text style={s.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              {catList.map(cat => (
                <TouchableOpacity key={cat.nombre} style={s.catRow}
                  onPress={() => { setRecCat(cat.nombre); setShowRecCatPicker(false); }}>
                  <Text style={s.catText}>{cat.icono}  {cat.nombre}</Text>
                  {recCat === cat.nombre && <Text style={s.checkMark}>✓</Text>}
                </TouchableOpacity>
              ))}
              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Edit Cuota ── */}
      <Modal visible={!!editCuota} animationType="slide" transparent>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle}>Editar Cuota</Text>
              <TouchableOpacity onPress={() => setEditCuota(null)}>
                <Text style={s.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

              <Text style={s.lbl}>Descripción</Text>
              <TextInput style={s.inp} value={cuotaDesc} onChangeText={setCuotaDesc} />

              <Text style={s.lbl}>Categoría</Text>
              <TouchableOpacity style={s.pickerRow} onPress={() => setShowCuotaCatPicker(true)}>
                <Text style={s.pickerText}>{iconForCat(cuotaCat, catList)} {cuotaCat || 'Seleccionar'}</Text>
                <Text style={s.chevron}>›</Text>
              </TouchableOpacity>

              <Text style={s.lbl}>Monto por cuota</Text>
              <TextInput style={s.inp} keyboardType="decimal-pad" value={cuotaMontoCuota} onChangeText={setCuotaMontoCuota} />

              <Text style={s.lbl}>Total de cuotas</Text>
              <TextInput style={s.inp} keyboardType="number-pad" value={cuotaTotal} onChangeText={setCuotaTotal} />

              {editCuota && (
                <View style={s.infoBox}>
                  <Text style={s.infoText}>
                    Cuotas pagadas: {Math.min(cuotaActual(editCuota.mes_inicio), parseInt(cuotaTotal || '0', 10))}
                    {'  ·  '}
                    Deuda si guardas: {
                      !isNaN(parseFloat(cuotaMontoCuota)) && !isNaN(parseInt(cuotaTotal, 10))
                        ? fmt(parseFloat(cuotaMontoCuota.replace(',', '.')) * Math.max(parseInt(cuotaTotal, 10) - cuotaActual(editCuota.mes_inicio), 0))
                        : '—'
                    }
                  </Text>
                </View>
              )}

              <Text style={s.lbl}>Día de cobro (1–31)</Text>
              <TextInput style={s.inp} keyboardType="number-pad" value={cuotaDia} onChangeText={setCuotaDia} />

              {!!cuotaError && <View style={s.errBox}><Text style={s.errText}>{cuotaError}</Text></View>}

              <View style={s.rowBtns}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setEditCuota(null)}>
                  <Text style={s.cancelText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.saveBtn, savingCuota && s.btnOff]} onPress={handleSaveCuota} disabled={savingCuota}>
                  {savingCuota ? <ActivityIndicator color="#fff" /> : <Text style={s.saveBtnText}>Guardar</Text>}
                </TouchableOpacity>
              </View>
              <View style={{ height: 24 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Cat picker (cuota) ── */}
      <Modal visible={showCuotaCatPicker} animationType="slide" transparent>
        <View style={s.overlay}>
          <View style={[s.sheet, { maxHeight: '70%' }]}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle}>Categoría</Text>
              <TouchableOpacity onPress={() => setShowCuotaCatPicker(false)}>
                <Text style={s.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              {catList.map(cat => (
                <TouchableOpacity key={cat.nombre} style={s.catRow}
                  onPress={() => { setCuotaCat(cat.nombre); setShowCuotaCatPicker(false); }}>
                  <Text style={s.catText}>{cat.icono}  {cat.nombre}</Text>
                  {cuotaCat === cat.nombre && <Text style={s.checkMark}>✓</Text>}
                </TouchableOpacity>
              ))}
              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Confirm delete Recurrente ── */}
      <Modal visible={!!confirmRec} animationType="fade" transparent>
        <View style={s.confirmBg}>
          <View style={s.confirmBox}>
            <Text style={s.confirmTitle}>¿Eliminar recurrente?</Text>
            <Text style={s.confirmSub}>
              Se eliminará "{confirmRec?.descripcion ?? confirmRec?.categoria}" de los gastos recurrentes.
              Las transacciones ya registradas no se verán afectadas.
            </Text>
            <View style={s.confirmBtns}>
              <TouchableOpacity style={s.confirmCancel} onPress={() => setConfirmRec(null)}>
                <Text style={s.confirmCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.confirmDanger, deletingRec && s.btnOff]}
                onPress={handleDeleteRec} disabled={deletingRec}>
                {deletingRec ? <ActivityIndicator color="#fff" /> : <Text style={s.confirmDangerText}>Eliminar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Confirm delete Cuota ── */}
      <Modal visible={!!confirmCuota} animationType="fade" transparent>
        <View style={s.confirmBg}>
          <View style={s.confirmBox}>
            <Text style={s.confirmTitle}>¿Eliminar cuota?</Text>
            <Text style={s.confirmSub}>
              Se eliminará "{confirmCuota?.descripcion}" y su seguimiento de cuotas.
              Las transacciones ya registradas no se verán afectadas.
            </Text>
            <View style={s.confirmBtns}>
              <TouchableOpacity style={s.confirmCancel} onPress={() => setConfirmCuota(null)}>
                <Text style={s.confirmCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.confirmDanger, deletingCuota && s.btnOff]}
                onPress={handleDeleteCuota} disabled={deletingCuota}>
                {deletingCuota ? <ActivityIndicator color="#fff" /> : <Text style={s.confirmDangerText}>Eliminar</Text>}
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
  safe: { flex: 1, backgroundColor: T.screen },

  header:  {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'android' ? 44 : 12,
    paddingHorizontal: 20, paddingBottom: 14,
    backgroundColor: T.card, borderBottomWidth: 1, borderBottomColor: T.border,
  },
  backBtn: { width: 70 },
  backText:{ fontSize: 16, color: T.accent, fontWeight: '500' },
  title:   { fontSize: 18, fontWeight: '700', color: T.textPrimary },

  scroll: { padding: 16, width: '100%', maxWidth: MAXW, alignSelf: 'center' },

  // Summary card (dark card — colores intencionales, no tocar)
  summaryCard:    { backgroundColor: '#0F172A', borderRadius: 20, padding: 20, marginBottom: 24 },
  summaryTitle:   { fontSize: 11, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 14 },
  summaryRow:     { flexDirection: 'row' },
  summaryCol:     { flex: 1, alignItems: 'center' },
  summaryAmt:     { fontSize: 20, fontWeight: '800', color: '#fff', marginBottom: 4 },
  summaryLabel:   { fontSize: 11, color: 'rgba(255,255,255,0.7)', fontWeight: '600', marginBottom: 2 },
  summarySub:     { fontSize: 10, color: 'rgba(255,255,255,0.4)' },
  summaryDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginHorizontal: 10 },

  // Section headers
  sectionHead:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: T.textPrimary },
  sectionCount: { fontSize: 12, color: T.textMicro },

  // Cards
  card:         {
    flexDirection: 'row', alignItems: 'center', backgroundColor: T.card,
    borderRadius: R.card, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: T.border,
  },
  cardInactive: { opacity: 0.5 },
  cardIcon:     { width: 38, height: 38, borderRadius: 10, backgroundColor: T.screen,
                  justifyContent: 'center', alignItems: 'center', marginRight: 10, flexShrink: 0 },
  cardBody:     { flex: 1, minWidth: 0 },
  cardName:     { fontSize: 14, fontWeight: '600', color: T.textPrimary, marginBottom: 2 },
  cardMeta:     { fontSize: 11, color: T.textMicro, marginBottom: 4 },
  cardRight:    { alignItems: 'flex-end', marginHorizontal: 8, flexShrink: 0 },
  cardAmt:      { fontSize: 14, fontWeight: '700', color: T.textPrimary },
  cardAmtSub:   { fontSize: 10, color: T.textMicro },
  cardActions:  { flexDirection: 'column', gap: 6, marginLeft: 4 },
  actionBtn:    { width: 30, height: 30, borderRadius: 8, backgroundColor: T.accentSoft,
                  justifyContent: 'center', alignItems: 'center' },
  actionBtnRed: { backgroundColor: T.redSoft },
  actionEdit:   { fontSize: 14, color: T.accent },
  actionDelete: { fontSize: 12, color: T.red },

  // Progress / debt
  progressBg:   { height: 4, backgroundColor: T.border, borderRadius: 2, overflow: 'hidden', marginBottom: 4 },
  progressFill: { height: '100%' as any, borderRadius: 2 },
  deudaTag:     { fontSize: 11, color: T.textSec, lineHeight: 16 },
  deudaAmt:     { fontWeight: '700', color: T.red },
  finishedTag:  { fontSize: 11, color: T.green, fontWeight: '600' },

  emptyBox:  { backgroundColor: T.card, borderRadius: R.control, padding: 16, marginBottom: 8, borderWidth: 1, borderColor: T.border },
  emptyText: { fontSize: 13, color: T.textMicro, textAlign: 'center' },

  // Sheet modal
  overlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end', alignItems: 'center' },
  sheet:      { backgroundColor: T.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
                width: '100%', maxWidth: MAXW, maxHeight: '90%', paddingHorizontal: 24 },
  sheetHead:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                paddingTop: 20, paddingBottom: 16 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: T.textPrimary },
  closeBtn:   { fontSize: 18, color: T.textMicro, padding: 4 },
  lbl:        { fontSize: 13, fontWeight: '500', color: T.textSec, marginBottom: 6 },
  optional:   { fontWeight: '400', color: T.textMicro },
  hint:       { fontSize: 11, color: T.textMicro, marginBottom: 14, marginTop: -10 },
  inp:        { height: 48, backgroundColor: T.input, borderWidth: 1, borderColor: T.inputBorder,
                borderRadius: R.control, paddingHorizontal: 14, fontSize: 15, color: T.textPrimary, marginBottom: 14 },
  pickerRow:  { height: 48, backgroundColor: T.input, borderWidth: 1, borderColor: T.inputBorder,
                borderRadius: R.control, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center',
                justifyContent: 'space-between', marginBottom: 14 },
  pickerText: { fontSize: 15, color: T.textPrimary },
  chevron:    { fontSize: 20, color: T.textMicro },
  infoBox:    { backgroundColor: T.accentSoft, borderRadius: R.control, padding: 12, marginBottom: 14 },
  infoText:   { fontSize: 12, color: T.accentDark, lineHeight: 18 },
  errBox:     { backgroundColor: T.redSoft, borderRadius: R.control, padding: 12, marginBottom: 12 },
  errText:    { color: T.red, fontSize: 13 },
  rowBtns:    { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn:  { flex: 1, height: 48, backgroundColor: T.screen, borderRadius: R.control,
                justifyContent: 'center', alignItems: 'center' },
  cancelText: { fontSize: 15, color: T.textSec, fontWeight: '500' },
  saveBtn:    { flex: 1, height: 48, backgroundColor: T.accent, borderRadius: R.control,
                justifyContent: 'center', alignItems: 'center' },
  saveBtnText:{ fontSize: 15, color: '#fff', fontWeight: '600' },
  btnOff:     { opacity: 0.6 },
  catRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: T.border },
  catText:    { fontSize: 15, color: T.textSec },
  checkMark:  { fontSize: 16, color: T.accent, fontWeight: '600' },

  // Confirm dialogs
  confirmBg:         { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center',
                        alignItems: 'center', padding: 20 },
  confirmBox:        { backgroundColor: T.card, borderRadius: 20, padding: 24, width: '100%', maxWidth: 360 },
  confirmTitle:      { fontSize: 16, fontWeight: '700', color: T.textPrimary, marginBottom: 10 },
  confirmSub:        { fontSize: 13, color: T.textSec, lineHeight: 20, marginBottom: 20 },
  confirmBtns:       { flexDirection: 'row', gap: 10 },
  confirmCancel:     { flex: 1, height: 46, backgroundColor: T.screen, borderRadius: R.control,
                       justifyContent: 'center', alignItems: 'center' },
  confirmCancelText: { fontSize: 14, color: T.textSec, fontWeight: '500' },
  confirmDanger:     { flex: 1, height: 46, backgroundColor: T.red, borderRadius: R.control,
                       justifyContent: 'center', alignItems: 'center' },
  confirmDangerText: { fontSize: 14, color: '#fff', fontWeight: '600' },
});
