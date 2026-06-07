import { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform,
  ActivityIndicator, Modal, TextInput, FlatList,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '@/lib/supabase';

type PrestamoTipo = 'recibido' | 'otorgado';

interface Prestamo {
  id: string;
  entidad_persona: string;
  tipo: PrestamoTipo;
  monto_total: number;
  saldo_pendiente: number;
  monto_mensual: number | null;
  descripcion: string | null;
  cuotas_estimadas: number | null;
  cuotas_pagadas: number;
  creado_en: string;
}

interface Abono {
  id: string;
  monto: number;
  fecha: string;
  descripcion: string | null;
}

const SYM: Record<string, string> = {
  PEN: 'S/', USD: '$', EUR: '€', BRL: 'R$', COP: '$', MXN: '$', ARS: '$', CLP: '$',
};

export default function Prestamos() {
  const { moneda } = useLocalSearchParams<{ moneda?: string }>();
  const currency = moneda ?? 'PEN';

  const fmt = (n: number) => {
    const s = SYM[currency] ?? currency;
    return `${s} ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const [prestamos,    setPrestamos]    = useState<Prestamo[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [showCreate,   setShowCreate]   = useState(false);

  // Abonos detail modal
  const [detailPrestamo, setDetailPrestamo] = useState<Prestamo | null>(null);
  const [abonos,         setAbonos]         = useState<Abono[]>([]);
  const [loadingAbonos,  setLoadingAbonos]  = useState(false);

  // Inline payment in detail modal
  const [pagoMonto,   setPagoMonto]   = useState('');
  const [pagoDesc,    setPagoDesc]    = useState('');
  const [pagoFecha,   setPagoFecha]   = useState(() => new Date().toISOString().slice(0, 10));
  const [savingPago,  setSavingPago]  = useState(false);
  const [pagoError,   setPagoError]   = useState('');
  const [pagoSuccess, setPagoSuccess] = useState(false);

  // Edit prestamo data
  const [showEditPrestamo, setShowEditPrestamo] = useState(false);
  const [editSaldo,        setEditSaldo]        = useState('');
  const [editMensual,      setEditMensual]      = useState('');
  const [editCuotas,       setEditCuotas]       = useState('');
  const [editError,        setEditError]        = useState('');
  const [editSaving,       setEditSaving]       = useState(false);

  // Create form
  const [form, setForm] = useState({
    entidad_persona:  '',
    tipo:             'recibido' as PrestamoTipo,
    monto_total:      '',
    monto_mensual:    '',
    cuotas_estimadas: '',
    descripcion:      '',
  });
  const [creating,     setCreating]     = useState(false);
  const [createError,  setCreateError]  = useState('');

  useEffect(() => { loadPrestamos(); }, []);

  const loadPrestamos = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data } = await supabase
      .from('prestamos')
      .select('id, entidad_persona, tipo, monto_total, saldo_pendiente, monto_mensual, descripcion, cuotas_estimadas, cuotas_pagadas, creado_en')
      .eq('user_id', user.id)
      .order('creado_en', { ascending: false });

    if (data) setPrestamos(data as Prestamo[]);
    setLoading(false);
  };

  const openDetail = async (p: Prestamo) => {
    setDetailPrestamo(p);
    setPagoMonto(p.monto_mensual ? String(p.monto_mensual) : '');
    setPagoDesc('');
    setPagoFecha(new Date().toISOString().slice(0, 10));
    setPagoError('');
    setPagoSuccess(false);
    setShowEditPrestamo(false);
    setEditError('');
    setLoadingAbonos(true);

    const { data } = await supabase
      .from('prestamos_abonos')
      .select('id, monto, fecha, descripcion')
      .eq('prestamo_id', p.id)
      .order('fecha', { ascending: false });

    if (data) setAbonos(data as Abono[]);
    setLoadingAbonos(false);
  };

  const handleRegistrarPago = async () => {
    if (!detailPrestamo) return;
    const m = parseFloat(pagoMonto.replace(',', '.'));
    if (isNaN(m) || m <= 0) { setPagoError('Ingresa un monto válido.'); return; }

    setPagoError('');
    setSavingPago(true);

    const { error } = await supabase.from('prestamos_abonos').insert({
      prestamo_id: detailPrestamo.id,
      monto:       m,
      fecha:       pagoFecha,
      descripcion: pagoDesc.trim() || null,
    });

    if (error) { setPagoError(error.message); setSavingPago(false); return; }

    // refresh
    await loadPrestamos();
    const { data } = await supabase
      .from('prestamos_abonos')
      .select('id, monto, fecha, descripcion')
      .eq('prestamo_id', detailPrestamo.id)
      .order('fecha', { ascending: false });
    if (data) setAbonos(data as Abono[]);

    // update local detail view
    const updated = (await supabase
      .from('prestamos')
      .select('id, entidad_persona, tipo, monto_total, saldo_pendiente, monto_mensual, descripcion, cuotas_estimadas, cuotas_pagadas, creado_en')
      .eq('id', detailPrestamo.id)
      .single()
    ).data;
    if (updated) setDetailPrestamo(updated as Prestamo);

    setPagoMonto('');
    setPagoDesc('');
    setPagoSuccess(true);
    setSavingPago(false);
  };

  const openEditPrestamo = () => {
    if (!detailPrestamo) return;
    setEditSaldo(String(Number(detailPrestamo.saldo_pendiente)));
    setEditMensual(detailPrestamo.monto_mensual ? String(detailPrestamo.monto_mensual) : '');
    setEditCuotas(detailPrestamo.cuotas_estimadas ? String(detailPrestamo.cuotas_estimadas) : '');
    setEditError('');
    setShowEditPrestamo(true);
  };

  const handleSaveEditPrestamo = async () => {
    if (!detailPrestamo) return;
    const saldo   = parseFloat(editSaldo.replace(',', '.'));
    const mensual = parseFloat(editMensual.replace(',', '.'));
    if (isNaN(saldo) || saldo < 0)     { setEditError('Saldo inválido.'); return; }
    if (isNaN(mensual) || mensual <= 0) { setEditError('Monto mensual inválido.'); return; }

    setEditError('');
    setEditSaving(true);

    const cuotas = parseInt(editCuotas, 10);
    const updates: Record<string, unknown> = {
      saldo_pendiente: saldo,
      monto_mensual:   mensual,
    };
    if (!isNaN(cuotas) && cuotas > 0) updates.cuotas_estimadas = cuotas;

    const { error } = await supabase
      .from('prestamos')
      .update(updates)
      .eq('id', detailPrestamo.id);

    if (error) { setEditError(error.message); setEditSaving(false); return; }

    const { data: updated } = await supabase
      .from('prestamos')
      .select('id, entidad_persona, tipo, monto_total, saldo_pendiente, monto_mensual, descripcion, cuotas_estimadas, cuotas_pagadas, creado_en')
      .eq('id', detailPrestamo.id)
      .single();
    if (updated) setDetailPrestamo(updated as Prestamo);

    await loadPrestamos();
    setShowEditPrestamo(false);
    setEditSaving(false);
  };

  const handleCreate = async () => {
    if (!form.entidad_persona.trim()) { setCreateError('Ingresa la entidad o persona.'); return; }
    const monto = parseFloat(form.monto_total.replace(',', '.'));
    if (isNaN(monto) || monto <= 0)  { setCreateError('Ingresa un monto válido.'); return; }
    const montoMensual = parseFloat(form.monto_mensual.replace(',', '.'));
    if (isNaN(montoMensual) || montoMensual <= 0) { setCreateError('Ingresa el monto mensual a pagar.'); return; }

    setCreateError('');
    setCreating(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setCreating(false); return; }

    const cuotas = form.cuotas_estimadas ? parseInt(form.cuotas_estimadas, 10) : null;

    const { error } = await supabase.from('prestamos').insert({
      user_id:          user.id,
      entidad_persona:  form.entidad_persona.trim(),
      tipo:             form.tipo,
      monto_total:      monto,
      saldo_pendiente:  monto,
      monto_mensual:    montoMensual,
      cuotas_estimadas: cuotas && !isNaN(cuotas) ? cuotas : null,
      descripcion:      form.descripcion.trim() || null,
    });

    if (error) { setCreateError(error.message); setCreating(false); return; }

    await loadPrestamos();
    setShowCreate(false);
    setForm({ entidad_persona: '', tipo: 'recibido', monto_total: '', monto_mensual: '', cuotas_estimadas: '', descripcion: '' });
    setCreating(false);
  };

  const progress = (p: Prestamo) =>
    p.monto_total > 0 ? Math.min(1, 1 - Number(p.saldo_pendiente) / Number(p.monto_total)) : 0;

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}>‹ Volver</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Préstamos</Text>
        <TouchableOpacity onPress={() => { setShowCreate(true); setCreateError(''); }}>
          <Text style={styles.addText}>＋ Nuevo</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color="#3B82F6" style={{ marginTop: 48 }} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        >
          {prestamos.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📋</Text>
              <Text style={styles.emptyTitle}>Sin préstamos registrados</Text>
              <Text style={styles.emptySub}>
                Toca "＋ Nuevo" para registrar un préstamo recibido u otorgado.
              </Text>
            </View>
          ) : (
            prestamos.map(p => {
              const pct = progress(p);
              const cuotasPendientes = p.cuotas_estimadas != null
                ? Math.max(0, p.cuotas_estimadas - p.cuotas_pagadas)
                : null;
              const pagado = Number(p.saldo_pendiente) === 0;

              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.card, pagado && styles.cardPagado]}
                  onPress={() => openDetail(p)}
                  activeOpacity={0.8}
                >
                  <View style={styles.cardTop}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.cardEntity} numberOfLines={1}>
                        {p.entidad_persona}
                      </Text>
                      <View style={styles.pills}>
                        <View style={[styles.pill, p.tipo === 'recibido' ? styles.pillRed : styles.pillGreen]}>
                          <Text style={styles.pillText}>
                            {p.tipo === 'recibido' ? 'Recibido' : 'Otorgado'}
                          </Text>
                        </View>
                        {pagado && (
                          <View style={[styles.pill, styles.pillGray]}>
                            <Text style={styles.pillText}>Pagado</Text>
                          </View>
                        )}
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.cardSaldo}>{fmt(Number(p.saldo_pendiente))}</Text>
                      <Text style={styles.cardSaldoLabel}>pendiente</Text>
                    </View>
                  </View>

                  {/* Progress bar */}
                  <View style={styles.progressBg}>
                    <View style={[styles.progressFill, { width: `${Math.round(pct * 100)}%` as any }]} />
                  </View>

                  <View style={styles.cardBottom}>
                    <Text style={styles.cardMeta}>
                      Total: {fmt(Number(p.monto_total))}
                    </Text>
                    {cuotasPendientes !== null && (
                      <Text style={styles.cardMeta}>
                        {cuotasPendientes === 0
                          ? `${p.cuotas_pagadas}/${p.cuotas_estimadas} cuotas`
                          : `${cuotasPendientes} cuota${cuotasPendientes !== 1 ? 's' : ''} pendiente${cuotasPendientes !== 1 ? 's' : ''}`}
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })
          )}
          <View style={{ height: 32 }} />
        </ScrollView>
      )}

      {/* ── Create modal ── */}
      <Modal visible={showCreate} animationType="slide" transparent>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Nuevo Préstamo</Text>
              <TouchableOpacity onPress={() => setShowCreate(false)}>
                <Text style={styles.closeBtn}>Cerrar</Text>
              </TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody}>
              <Text style={styles.label}>Entidad / Persona *</Text>
              <TextInput
                style={styles.input}
                placeholder="Ej: Banco BCP, Juan García…"
                placeholderTextColor="#9CA3AF"
                value={form.entidad_persona}
                onChangeText={v => setForm(f => ({ ...f, entidad_persona: v }))}
              />

              <Text style={styles.label}>Tipo</Text>
              <View style={styles.toggle}>
                <TouchableOpacity
                  style={[styles.toggleOpt, form.tipo === 'recibido' && styles.toggleActive]}
                  onPress={() => setForm(f => ({ ...f, tipo: 'recibido' }))}
                >
                  <Text style={[styles.toggleText, form.tipo === 'recibido' && styles.toggleActiveText]}>
                    Recibido (te prestaron)
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toggleOpt, form.tipo === 'otorgado' && styles.toggleActive]}
                  onPress={() => setForm(f => ({ ...f, tipo: 'otorgado' }))}
                >
                  <Text style={[styles.toggleText, form.tipo === 'otorgado' && styles.toggleActiveText]}>
                    Otorgado (prestaste)
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>Monto Total *</Text>
              <TextInput
                style={styles.input}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="#9CA3AF"
                value={form.monto_total}
                onChangeText={v => setForm(f => ({ ...f, monto_total: v }))}
              />

              <Text style={styles.label}>Monto Mensual a Pagar *</Text>
              <TextInput
                style={styles.input}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="#9CA3AF"
                value={form.monto_mensual}
                onChangeText={v => setForm(f => ({ ...f, monto_mensual: v }))}
              />

              <Text style={styles.label}>N.° de Cuotas Estimadas (opcional)</Text>
              <TextInput
                style={styles.input}
                keyboardType="number-pad"
                placeholder="Ej: 12"
                placeholderTextColor="#9CA3AF"
                value={form.cuotas_estimadas}
                onChangeText={v => setForm(f => ({ ...f, cuotas_estimadas: v }))}
              />

              <Text style={styles.label}>Descripción (opcional)</Text>
              <TextInput
                style={[styles.input, { height: 80, textAlignVertical: 'top', paddingTop: 12 }]}
                multiline
                placeholder="Notas adicionales…"
                placeholderTextColor="#9CA3AF"
                value={form.descripcion}
                onChangeText={v => setForm(f => ({ ...f, descripcion: v }))}
              />

              {!!createError && <Text style={styles.errorText}>{createError}</Text>}

              <TouchableOpacity
                style={[styles.saveBtn, creating && styles.btnDisabled]}
                onPress={handleCreate}
                disabled={creating}
              >
                {creating
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.saveBtnText}>Registrar Préstamo</Text>
                }
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Detail / Abonos modal ── */}
      <Modal visible={!!detailPrestamo} animationType="slide" transparent>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, styles.detailSheet]}>
            {detailPrestamo && (
              <>
                <View style={styles.sheetHeader}>
                  <Text style={styles.sheetTitle} numberOfLines={1}>
                    {detailPrestamo.entidad_persona}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
                    <TouchableOpacity onPress={openEditPrestamo}>
                      <Text style={styles.editBtn}>✎ Editar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setDetailPrestamo(null)}>
                      <Text style={styles.closeBtn}>Cerrar</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody}>
                  {/* Summary */}
                  <View style={styles.detailSummary}>
                    <View style={styles.detailStat}>
                      <Text style={styles.detailStatVal}>{fmt(Number(detailPrestamo.monto_total))}</Text>
                      <Text style={styles.detailStatLabel}>Monto total</Text>
                    </View>
                    <View style={styles.detailDivider} />
                    <View style={styles.detailStat}>
                      <Text style={[styles.detailStatVal, { color: '#DC2626' }]}>
                        {fmt(Number(detailPrestamo.saldo_pendiente))}
                      </Text>
                      <Text style={styles.detailStatLabel}>Saldo pendiente</Text>
                    </View>
                    {detailPrestamo.cuotas_estimadas && (
                      <>
                        <View style={styles.detailDivider} />
                        <View style={styles.detailStat}>
                          <Text style={styles.detailStatVal}>
                            {detailPrestamo.cuotas_pagadas}/{detailPrestamo.cuotas_estimadas}
                          </Text>
                          <Text style={styles.detailStatLabel}>Cuotas</Text>
                        </View>
                      </>
                    )}
                  </View>

                  {/* Inline payment form */}
                  {Number(detailPrestamo.saldo_pendiente) > 0 && (
                    <View style={styles.pagoInline}>
                      <Text style={styles.pagoInlineTitle}>Registrar Pago</Text>
                      <TextInput
                        style={styles.input}
                        keyboardType="decimal-pad"
                        placeholder="Monto"
                        placeholderTextColor="#9CA3AF"
                        value={pagoMonto}
                        onChangeText={setPagoMonto}
                      />
                      <TextInput
                        style={styles.input}
                        placeholder="Fecha (AAAA-MM-DD)"
                        placeholderTextColor="#9CA3AF"
                        value={pagoFecha}
                        onChangeText={setPagoFecha}
                      />
                      <TextInput
                        style={styles.input}
                        placeholder="Descripción (opcional)"
                        placeholderTextColor="#9CA3AF"
                        value={pagoDesc}
                        onChangeText={setPagoDesc}
                      />
                      {!!pagoError && <Text style={styles.errorText}>{pagoError}</Text>}
                      {pagoSuccess && (
                        <Text style={styles.pagoSuccessText}>✓ Pago registrado. Saldo actualizado.</Text>
                      )}
                      <TouchableOpacity
                        style={[styles.saveBtn, savingPago && styles.btnDisabled]}
                        onPress={handleRegistrarPago}
                        disabled={savingPago}
                      >
                        {savingPago
                          ? <ActivityIndicator color="#fff" />
                          : <Text style={styles.saveBtnText}>Registrar Pago</Text>
                        }
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Edit section */}
                  {showEditPrestamo && (
                    <View style={styles.editSection}>
                      <Text style={styles.editSectionTitle}>Ajustar Datos del Préstamo</Text>
                      <Text style={styles.label}>Saldo Pendiente</Text>
                      <TextInput
                        style={styles.input}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        placeholderTextColor="#9CA3AF"
                        value={editSaldo}
                        onChangeText={setEditSaldo}
                      />
                      <Text style={styles.label}>Monto Mensual</Text>
                      <TextInput
                        style={styles.input}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        placeholderTextColor="#9CA3AF"
                        value={editMensual}
                        onChangeText={setEditMensual}
                      />
                      <Text style={styles.label}>Cuotas Estimadas (opcional)</Text>
                      <TextInput
                        style={styles.input}
                        keyboardType="number-pad"
                        placeholder="Ej: 12"
                        placeholderTextColor="#9CA3AF"
                        value={editCuotas}
                        onChangeText={setEditCuotas}
                      />
                      {!!editError && <Text style={styles.errorText}>{editError}</Text>}
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <TouchableOpacity
                          style={[styles.saveBtn, { flex: 1, backgroundColor: '#F3F4F6' }]}
                          onPress={() => setShowEditPrestamo(false)}
                        >
                          <Text style={[styles.saveBtnText, { color: '#374151' }]}>Cancelar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.saveBtn, { flex: 1 }, editSaving && styles.btnDisabled]}
                          onPress={handleSaveEditPrestamo}
                          disabled={editSaving}
                        >
                          {editSaving
                            ? <ActivityIndicator color="#fff" />
                            : <Text style={styles.saveBtnText}>Guardar</Text>
                          }
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                  {/* Abono history */}
                  <Text style={[styles.label, { marginTop: 20 }]}>
                    Historial de Pagos ({abonos.length})
                  </Text>
                  {loadingAbonos ? (
                    <ActivityIndicator color="#3B82F6" style={{ marginTop: 16 }} />
                  ) : abonos.length === 0 ? (
                    <Text style={styles.noAbonos}>Sin pagos registrados aún</Text>
                  ) : (
                    abonos.map((a, idx) => (
                      <View key={a.id} style={[styles.abonoRow, idx > 0 && styles.abonoSep]}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.abonoDesc}>{a.descripcion || 'Pago'}</Text>
                          <Text style={styles.abonoFecha}>
                            {new Date(a.fecha).toLocaleDateString('es-PE', {
                              day: '2-digit', month: 'short', year: 'numeric',
                            })}
                          </Text>
                        </View>
                        <Text style={styles.abonoMonto}>{fmt(Number(a.monto))}</Text>
                      </View>
                    ))
                  )}
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const isWeb = Platform.OS === 'web';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F3F4F6' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: isWeb ? 20 : 56, paddingHorizontal: 20, paddingBottom: 16,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  backText: { fontSize: 16, color: '#3B82F6', fontWeight: '500' },
  title:    { fontSize: 18, fontWeight: '700', color: '#111827' },
  addText:  { fontSize: 15, color: '#3B82F6', fontWeight: '600' },

  list: { padding: 16 },

  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  cardPagado: { opacity: 0.7 },
  cardTop:    { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  cardEntity: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 6 },
  pills:      { flexDirection: 'row', gap: 6 },
  pill:       { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  pillRed:    { backgroundColor: '#FEE2E2' },
  pillGreen:  { backgroundColor: '#D1FAE5' },
  pillGray:   { backgroundColor: '#F3F4F6' },
  pillText:   { fontSize: 11, fontWeight: '600', color: '#374151' },
  cardSaldo:      { fontSize: 18, fontWeight: '800', color: '#111827' },
  cardSaldoLabel: { fontSize: 11, color: '#9CA3AF', marginTop: 2 },

  progressBg:   { height: 6, backgroundColor: '#F3F4F6', borderRadius: 3, marginBottom: 10, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#3B82F6', borderRadius: 3 },

  cardBottom: { flexDirection: 'row', justifyContent: 'space-between' },
  cardMeta:   { fontSize: 12, color: '#6B7280' },

  empty:     { alignItems: 'center', paddingVertical: 64 },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#374151', marginBottom: 6 },
  emptySub:  { fontSize: 13, color: '#9CA3AF', textAlign: 'center', lineHeight: 18, paddingHorizontal: 20 },

  // Modals
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end', alignItems: 'center',
  },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    width: '100%', maxWidth: 600, maxHeight: '85%',
  },
  detailSheet: { maxHeight: '90%' },
  sheetHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: '#111827', flex: 1, minWidth: 0 },
  closeBtn:   { fontSize: 15, color: '#3B82F6', fontWeight: '500', marginLeft: 12 },
  sheetBody:  { padding: 20, paddingBottom: 36 },

  label: { fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 },
  input: {
    height: 52, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: 12, paddingHorizontal: 16, fontSize: 15, color: '#111827', marginBottom: 14,
  },
  toggle: {
    flexDirection: 'row', backgroundColor: '#F3F4F6', borderRadius: 10, padding: 3, marginBottom: 14,
  },
  toggleOpt:        { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  toggleActive:     { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 3, elevation: 1 },
  toggleText:       { fontSize: 12, fontWeight: '500', color: '#6B7280' },
  toggleActiveText: { color: '#111827', fontWeight: '600' },

  errorText: { color: '#DC2626', fontSize: 13, marginBottom: 12, backgroundColor: '#FEF2F2', borderRadius: 8, padding: 10 },

  saveBtn: {
    height: 52, backgroundColor: '#3B82F6', borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  btnDisabled: { opacity: 0.6 },

  // Detail
  detailSummary: {
    flexDirection: 'row', backgroundColor: '#F9FAFB', borderRadius: 12,
    padding: 16, marginBottom: 20, alignItems: 'center',
  },
  detailStat:      { flex: 1, alignItems: 'center' },
  detailStatVal:   { fontSize: 15, fontWeight: '800', color: '#111827' },
  detailStatLabel: { fontSize: 11, color: '#9CA3AF', marginTop: 3 },
  detailDivider:   { width: 1, height: 36, backgroundColor: '#E5E7EB' },

  editBtn: { fontSize: 13, color: '#6B7280', fontWeight: '500' },

  pagoInline: {
    backgroundColor: '#EFF6FF', borderRadius: 12, padding: 16, marginBottom: 8,
  },
  pagoInlineTitle:  { fontSize: 14, fontWeight: '700', color: '#1D4ED8', marginBottom: 12 },
  pagoSuccessText:  { color: '#059669', fontSize: 13, fontWeight: '600', backgroundColor: '#D1FAE5', borderRadius: 8, padding: 10, marginBottom: 10 },

  editSection: {
    backgroundColor: '#FFFBEB', borderRadius: 12, padding: 16, marginTop: 8, marginBottom: 8,
    borderWidth: 1, borderColor: '#FDE68A',
  },
  editSectionTitle: { fontSize: 14, fontWeight: '700', color: '#92400E', marginBottom: 14 },

  noAbonos: { fontSize: 13, color: '#9CA3AF', marginTop: 8, marginBottom: 8 },
  abonoRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
  },
  abonoSep:   { borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  abonoDesc:  { fontSize: 14, color: '#374151', fontWeight: '500' },
  abonoFecha: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  abonoMonto: { fontSize: 14, fontWeight: '700', color: '#059669', marginLeft: 12, flexShrink: 0 },
});
