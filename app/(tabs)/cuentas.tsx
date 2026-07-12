import { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Platform, ActivityIndicator, Modal, TextInput, SafeAreaView,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { DatePickerInput } from '@/components/DatePickerInput';

interface Tarjeta  { id:string; banco:string; nombre_tarjeta:string; deuda_actual:number; linea_credito:number; dia_cierre:number|null }
interface Prestamo { id:string; entidad_persona:string; tipo:'recibido'|'otorgado'; saldo_pendiente:number; monto_mensual:number; cuotas_estimadas:number|null; cuotas_pagadas:number }
interface Cuenta   { id:string; nombre_cuenta:string; saldo_actual:number }

const SYM: Record<string,string> = { PEN:'S/', USD:'$', EUR:'€', BRL:'R$', COP:'$', MXN:'$', ARS:'$', CLP:'$' };
const BANK_COLORS: Record<string,string> = {
  BCP:'#1A56DB', BBVA:'#004481', Scotiabank:'#EC1C24', Interbank:'#00AA4F',
  Banbif:'#E30613', Pichincha:'#E3051B', Mibanco:'#E62129',
};

function bankColor(banco: string) {
  const key = Object.keys(BANK_COLORS).find(k => banco.toLowerCase().includes(k.toLowerCase()));
  return key ? BANK_COLORS[key] : '#374151';
}

export default function Cuentas() {
  const [currency, setCurrency] = useState('PEN');
  const [tarjetas, setTarjetas] = useState<Tarjeta[]>([]);
  const [prestamos,setPrestamos]= useState<Prestamo[]>([]);
  const [cuentas,  setCuentas]  = useState<Cuenta[]>([]);
  const [loading,  setLoading]  = useState(true);

  // FAB menú
  const [showFabMenu, setShowFabMenu] = useState(false);

  // Tarjeta
  const [showNewTar,   setShowNewTar]   = useState(false);
  const [editTar,      setEditTar]      = useState<Tarjeta|null>(null);
  const [tarForm,      setTarForm]      = useState({ banco:'', nombre:'', linea:'', deuda:'', dia_cierre:'' });
  const [tarError,     setTarError]     = useState('');
  const [tarSaving,    setTarSaving]    = useState(false);

  // Ciclo de facturación
  const [gastosCiclo,   setGastosCiclo]  = useState<Record<string, { total:number; sincronizando:boolean }>>({});
  const [cicloInputs,   setCicloInputs]  = useState<Record<string, { desde:string; hasta:string }>>({});

  // Préstamo
  const [showNewPre,   setShowNewPre]   = useState(false);
  const [editPre,      setEditPre]      = useState<Prestamo|null>(null);
  const [preForm,      setPreForm]      = useState({ entidad:'', tipo:'recibido' as 'recibido'|'otorgado', monto_total:'', saldo:'', mensual:'' });
  const [preError,     setPreError]     = useState('');
  const [preSaving,    setPreSaving]    = useState(false);

  // Cuenta ahorro
  const [showNewCue,   setShowNewCue]   = useState(false);
  const [editCue,      setEditCue]      = useState<Cuenta|null>(null);
  const [cueForm,      setCueForm]      = useState({ nombre:'', saldo:'' });
  const [cueError,     setCueError]     = useState('');
  const [cueSaving,    setCueSaving]    = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        setLoading(true);
        const { data:{ user } } = await supabase.auth.getUser();
        if (!user || !active) return;
        const [pRes, tarRes, preRes, cueRes] = await Promise.all([
          supabase.from('profiles').select('moneda_base').eq('id', user.id).single(),
          supabase.from('tarjetas_credito').select('id,banco,nombre_tarjeta,deuda_actual,linea_credito,dia_cierre').eq('user_id', user.id).order('creado_en', { ascending: true }),
          supabase.from('prestamos').select('id,entidad_persona,tipo,saldo_pendiente,monto_mensual,cuotas_estimadas,cuotas_pagadas').eq('user_id', user.id).gt('saldo_pendiente', 0).order('creado_en', { ascending: true }),
          supabase.from('cuentas_ahorro').select('id,nombre_cuenta,saldo_actual').eq('user_id', user.id).order('creado_en', { ascending: true }),
        ]);
        if (!active) return;
        if (pRes.data)   setCurrency((pRes.data as any).moneda_base ?? 'PEN');
        if (tarRes.data) setTarjetas(tarRes.data as Tarjeta[]);
        if (preRes.data) setPrestamos(preRes.data as Prestamo[]);
        if (cueRes.data) setCuentas(cueRes.data as Cuenta[]);
        setLoading(false);

        // Inicializar inputs de ciclo en ISO (YYYY-MM-DD) para cada tarjeta
        if (tarRes.data) {
          const hoy      = new Date();
          const yy       = hoy.getFullYear();
          const mm       = String(hoy.getMonth() + 1).padStart(2, '0');
          const dd       = String(hoy.getDate()).padStart(2, '0');
          const defDesde = `${yy}-${mm}-01`;
          const defHasta = `${yy}-${mm}-${dd}`;
          const inputs: Record<string, { desde:string; hasta:string }> = {};
          for (const t of tarRes.data as Tarjeta[]) {
            inputs[t.id] = { desde: defDesde, hasta: defHasta };
          }
          setCicloInputs(inputs);
        }
      })();
      return () => { active = false; };
    }, [])
  );

  const sym = SYM[currency] ?? currency;
  const fmt = (n: number) => `${sym} ${n.toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2})}`;

  // ── Ciclo facturación ──────────────────────────────────────────────────────

  async function loadCicloCustom(tarjetaId: string, desdeInput: string, hastaInput: string) {
    if (!desdeInput || !hastaInput) return;
    const desdeStr = desdeInput;
    const hastaStr = hastaInput;

    setGastosCiclo(prev => ({ ...prev, [tarjetaId]: { total: prev[tarjetaId]?.total ?? 0, sincronizando: true } }));

    // Fix bug: incluye txs sin fecha explícita usando creado_en como fallback
    const { data } = await supabase
      .from('transacciones')
      .select('monto,moneda,tipo_cambio')
      .eq('tarjeta_id', tarjetaId)
      .eq('metodo_pago', 'tarjeta')
      .eq('activo', true)
      .or(
        `and(fecha.gte.${desdeStr},fecha.lt.${hastaStr}),` +
        `and(fecha.is.null,creado_en.gte.${desdeStr}T00:00:00,creado_en.lt.${hastaStr}T00:00:00)`
      );

    const total = (data ?? []).reduce((sum, tx) => {
      const m   = Number(tx.monto);
      const mon = tx.moneda ?? 'PEN';
      return sum + (mon === 'PEN' ? m : m * Number(tx.tipo_cambio ?? 1));
    }, 0);

    setGastosCiclo(prev => ({ ...prev, [tarjetaId]: { total, sincronizando: false } }));
  }

  async function handleSyncDeudaCiclo(tar: Tarjeta) {
    const ciclo = gastosCiclo[tar.id];
    if (!ciclo || ciclo.sincronizando) return;
    const nueva = ciclo.total;
    await supabase.from('tarjetas_credito').update({ deuda_actual: nueva }).eq('id', tar.id);
    setTarjetas(prev => prev.map(t => t.id === tar.id ? { ...t, deuda_actual: nueva } : t));
  }

  function setCicloInput(tarjetaId: string, field: 'desde'|'hasta', value: string) {
    setCicloInputs(prev => ({ ...prev, [tarjetaId]: { ...prev[tarjetaId], [field]: value } }));
  }

  // ── Tarjeta handlers
  const handleSaveTar = async () => {
    if (!tarForm.banco.trim())  { setTarError('Banco es requerido.'); return; }
    if (!tarForm.nombre.trim()) { setTarError('Nombre de tarjeta es requerido.'); return; }
    const diaCierreRaw = parseInt(tarForm.dia_cierre.trim(), 10);
    const diaCierre = !isNaN(diaCierreRaw) && diaCierreRaw >= 1 && diaCierreRaw <= 31 ? diaCierreRaw : null;
    setTarError(''); setTarSaving(true);
    const { data:{ user } } = await supabase.auth.getUser();
    if (!user) { setTarSaving(false); return; }
    if (editTar) {
      const linea = parseFloat(tarForm.linea) || 0;
      const deuda = parseFloat(tarForm.deuda) || 0;
      await supabase.from('tarjetas_credito').update({ banco: tarForm.banco.trim(), nombre_tarjeta: tarForm.nombre.trim(), linea_credito: linea, deuda_actual: deuda, dia_cierre: diaCierre }).eq('id', editTar.id);
      setTarjetas(prev => prev.map(t => t.id === editTar.id ? { ...t, banco: tarForm.banco.trim(), nombre_tarjeta: tarForm.nombre.trim(), linea_credito: linea, deuda_actual: deuda, dia_cierre: diaCierre } : t));
      setEditTar(null);
    } else {
      const { data, error } = await supabase.from('tarjetas_credito').insert({
        user_id: user.id, banco: tarForm.banco.trim(), nombre_tarjeta: tarForm.nombre.trim(),
        linea_credito: parseFloat(tarForm.linea) || 0, deuda_actual: parseFloat(tarForm.deuda) || 0,
        dia_cierre: diaCierre,
      }).select('id,banco,nombre_tarjeta,deuda_actual,linea_credito,dia_cierre').single();
      if (error) { setTarError(error.message); setTarSaving(false); return; }
      if (data) {
        setTarjetas(prev => [...prev, data as Tarjeta]);
        // Inicializar inputs de ciclo para la nueva tarjeta
        const hoy = new Date();
        setCicloInputs(prev => ({
          ...prev,
          [(data as Tarjeta).id]: {
            desde: `01/${String(hoy.getMonth()+1).padStart(2,'0')}/${hoy.getFullYear()}`,
            hasta: `${String(hoy.getDate()).padStart(2,'0')}/${String(hoy.getMonth()+1).padStart(2,'0')}/${hoy.getFullYear()}`,
          },
        }));
      }
      setShowNewTar(false);
    }
    setTarForm({ banco:'', nombre:'', linea:'', deuda:'', dia_cierre:'' });
    setTarSaving(false);
  };

  // ── Préstamo handlers
  const handleSavePre = async () => {
    if (!preForm.entidad.trim()) { setPreError('Entidad es requerida.'); return; }
    const mTotal   = parseFloat(preForm.monto_total.replace(',','.'));
    const sSaldo   = parseFloat(preForm.saldo.replace(',','.'));
    const mMensual = parseFloat(preForm.mensual.replace(',','.'));
    if (isNaN(mTotal)   || mTotal <= 0)   { setPreError('Monto total inválido.'); return; }
    if (isNaN(sSaldo)   || sSaldo < 0)    { setPreError('Saldo pendiente inválido.'); return; }
    if (isNaN(mMensual) || mMensual <= 0) { setPreError('Monto mensual inválido.'); return; }
    setPreError(''); setPreSaving(true);
    const { data:{ user } } = await supabase.auth.getUser();
    if (!user) { setPreSaving(false); return; }
    if (editPre) {
      await supabase.from('prestamos').update({ saldo_pendiente: sSaldo, monto_mensual: mMensual }).eq('id', editPre.id);
      setPrestamos(prev => prev.map(p => p.id === editPre.id ? { ...p, saldo_pendiente: sSaldo, monto_mensual: mMensual } : p));
      setEditPre(null);
    } else {
      const { error } = await supabase.from('prestamos').insert({
        user_id: user.id, entidad_persona: preForm.entidad.trim(), tipo: preForm.tipo,
        monto_total: mTotal, saldo_pendiente: sSaldo, monto_mensual: mMensual,
      });
      if (error) { setPreError(error.message); setPreSaving(false); return; }
      const { data } = await supabase.from('prestamos').select('id,entidad_persona,tipo,saldo_pendiente,monto_mensual,cuotas_estimadas,cuotas_pagadas').eq('user_id', user.id).gt('saldo_pendiente', 0).order('creado_en', { ascending: true });
      if (data) setPrestamos(data as Prestamo[]);
      setShowNewPre(false);
    }
    setPreForm({ entidad:'', tipo:'recibido', monto_total:'', saldo:'', mensual:'' });
    setPreSaving(false);
  };

  // ── Cuenta handlers
  const handleSaveCue = async () => {
    if (!cueForm.nombre.trim()) { setCueError('Nombre requerido.'); return; }
    const saldo = parseFloat(cueForm.saldo.replace(',','.'));
    if (isNaN(saldo) || saldo < 0) { setCueError('Saldo inválido.'); return; }
    setCueError(''); setCueSaving(true);
    const { data:{ user } } = await supabase.auth.getUser();
    if (!user) { setCueSaving(false); return; }
    if (editCue) {
      await supabase.from('cuentas_ahorro').update({ nombre_cuenta: cueForm.nombre.trim(), saldo_actual: saldo }).eq('id', editCue.id);
      setCuentas(prev => prev.map(c => c.id === editCue.id ? { ...c, nombre_cuenta: cueForm.nombre.trim(), saldo_actual: saldo } : c));
      setEditCue(null);
    } else {
      const { data, error } = await supabase.from('cuentas_ahorro').insert({
        user_id: user.id, nombre_cuenta: cueForm.nombre.trim(), saldo_actual: saldo,
      }).select('id,nombre_cuenta,saldo_actual').single();
      if (error) { setCueError(error.message); setCueSaving(false); return; }
      if (data) setCuentas(prev => [...prev, data as Cuenta]);
      setShowNewCue(false);
    }
    setCueForm({ nombre:'', saldo:'' });
    setCueSaving(false);
  };

  const openEditTar = (t: Tarjeta) => { setTarForm({ banco: t.banco, nombre: t.nombre_tarjeta, linea: String(Number(t.linea_credito)), deuda: String(Number(t.deuda_actual)), dia_cierre: t.dia_cierre != null ? String(t.dia_cierre) : '' }); setTarError(''); setEditTar(t); };
  const openEditPre = (p: Prestamo) => { setPreForm({ entidad: p.entidad_persona, tipo: p.tipo, monto_total: '', saldo: String(Number(p.saldo_pendiente)), mensual: String(Number(p.monto_mensual)) }); setPreError(''); setEditPre(p); };
  const openEditCue = (c: Cuenta)   => { setCueForm({ nombre: c.nombre_cuenta, saldo: String(Number(c.saldo_actual)) }); setCueError(''); setEditCue(c); };

  const totalAhorros  = cuentas.reduce((s,c)  => s + Number(c.saldo_actual), 0);
  const totalDeuda    = tarjetas.reduce((s,t) => s + Number(t.deuda_actual), 0);
  const totalPrestamo = prestamos.reduce((s,p)=> s + Number(p.saldo_pendiente), 0);

  function SectionCard({ title, value, color, children }: any) {
    return (
      <View style={[styles.sectionCard, { borderLeftColor: color }]}>
        <View style={styles.sectionCardHead}>
          <Text style={[styles.sectionCardTitle, { color }]}>{title}</Text>
          <Text style={[styles.sectionCardTotal, { color }]}>{value}</Text>
        </View>
        <View style={styles.divider} />
        {children}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#F8F9FB' }}>
      <SafeAreaView style={{ backgroundColor: '#F8F9FB' }}>
        <View style={styles.header}>
          <Text style={styles.title}>Mis Cuentas</Text>
        </View>
      </SafeAreaView>

      {loading ? (
        <ActivityIndicator color="#3B82F6" style={{ marginTop: 60 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          {/* ── Ahorros ── */}
          <SectionCard title="🏦 Ahorros & Inversiones" value={fmt(totalAhorros)} color="#0891B2">
            {cuentas.length === 0 ? (
              <Text style={styles.empty}>Sin cuentas de ahorro. Toca ＋ para crear una.</Text>
            ) : cuentas.map((c, i) => (
              <View key={c.id}>
                <View style={styles.prodRow}>
                  <View style={{ flex:1 }}>
                    <Text style={styles.prodName}>{c.nombre_cuenta}</Text>
                  </View>
                  <Text style={styles.prodAmount}>{fmt(Number(c.saldo_actual))}</Text>
                  <TouchableOpacity style={styles.editBtn} onPress={() => openEditCue(c)}>
                    <Text style={styles.editBtnText}>✎</Text>
                  </TouchableOpacity>
                </View>
                {i < cuentas.length - 1 && <View style={styles.rowSep} />}
              </View>
            ))}
            <TouchableOpacity style={styles.sectionFooter} onPress={() => router.push(`/ahorros?moneda=${currency}`)}>
              <Text style={{ color:'#0891B2', fontWeight:'600', fontSize:13 }}>Registrar movimiento →</Text>
            </TouchableOpacity>
          </SectionCard>

          {/* ── Tarjetas ── */}
          <SectionCard title="💳 Tarjetas de Crédito" value={fmt(totalDeuda)} color="#DC2626">
            {tarjetas.length === 0 ? (
              <Text style={styles.empty}>Sin tarjetas. Toca ＋ para agregar una.</Text>
            ) : tarjetas.map((t, i) => {
              const color = bankColor(t.banco);
              const disp  = Math.max(0, Number(t.linea_credito) - Number(t.deuda_actual));
              const pct   = Number(t.linea_credito) > 0 ? Math.min(Number(t.deuda_actual) / Number(t.linea_credito), 1) : 0;
              const ciclo = gastosCiclo[t.id];
              return (
                <View key={t.id}>
                  <View style={styles.tarjetaCard}>
                    <View style={[styles.bankBadge, { backgroundColor: color }]}>
                      <Text style={styles.bankBadgeText}>{t.banco.slice(0,3).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex:1 }}>
                      <Text style={styles.prodName}>{t.nombre_tarjeta}</Text>
                      <View style={styles.barBg}>
                        <View style={[styles.barFill, { width:`${Math.round(pct*100)}%` as any, backgroundColor: pct >= 0.9 ? '#DC2626' : pct >= 0.7 ? '#F59E0B' : '#6B7280' }]} />
                      </View>
                      <View style={{ flexDirection:'row', justifyContent:'space-between', marginTop:3 }}>
                        <Text style={styles.miniLabel}>Deuda: {fmt(Number(t.deuda_actual))}</Text>
                        <Text style={styles.miniLabel}>Disp: {fmt(disp)}</Text>
                      </View>
                    </View>
                    <TouchableOpacity style={styles.editBtn} onPress={() => openEditTar(t)}>
                      <Text style={styles.editBtnText}>✎</Text>
                    </TouchableOpacity>
                  </View>

                  {/* ── Consolidado de ciclo (manual) ── */}
                  {(() => {
                    const inputs = cicloInputs[t.id] ?? { desde:'', hasta:'' };
                    const canCalc = !!inputs.desde && !!inputs.hasta;
                    return (
                      <View style={styles.cicloBox}>
                        <Text style={styles.cicloTitle}>CONSOLIDADO DE CICLO</Text>
                        <View style={styles.cicloRow}>
                          <View style={styles.cicloField}>
                            <Text style={styles.cicloFieldLabel}>Desde</Text>
                            <DatePickerInput
                              value={inputs.desde}
                              onChange={v => setCicloInput(t.id, 'desde', v)}
                              inputStyle={styles.cicloInput}
                            />
                          </View>
                          <View style={styles.cicloField}>
                            <Text style={styles.cicloFieldLabel}>Hasta</Text>
                            <DatePickerInput
                              value={inputs.hasta}
                              onChange={v => setCicloInput(t.id, 'hasta', v)}
                              inputStyle={styles.cicloInput}
                            />
                          </View>
                          <TouchableOpacity
                            style={[styles.cicloCalcBtn, !canCalc && { opacity:0.4 }]}
                            onPress={() => canCalc && loadCicloCustom(t.id, inputs.desde, inputs.hasta)}
                            disabled={!canCalc}
                          >
                            <Text style={styles.cicloCalcText}>Calcular</Text>
                          </TouchableOpacity>
                        </View>
                        {ciclo ? (
                          ciclo.sincronizando ? (
                            <View style={{ flexDirection:'row', alignItems:'center', gap:6, marginTop:8 }}>
                              <ActivityIndicator size="small" color="#DC2626" />
                              <Text style={styles.cicloSub}>Calculando…</Text>
                            </View>
                          ) : (
                            <View style={styles.cicloResult}>
                              <View>
                                <Text style={styles.cicloTotal}>{fmt(ciclo.total)}</Text>
                                <Text style={styles.cicloSub}>Total de gastos con esta tarjeta</Text>
                              </View>
                              <TouchableOpacity style={styles.cicloBtn} onPress={() => handleSyncDeudaCiclo(t)}>
                                <Text style={styles.cicloBtnText}>Actualizar{'\n'}deuda</Text>
                              </TouchableOpacity>
                            </View>
                          )
                        ) : (
                          <Text style={[styles.cicloSub, { marginTop:6 }]}>Ingresa un rango y toca Calcular</Text>
                        )}
                      </View>
                    );
                  })()}

                  {i < tarjetas.length - 1 && <View style={[styles.rowSep, { marginTop: 8 }]} />}
                </View>
              );
            })}
            <TouchableOpacity style={styles.sectionFooter} onPress={() => router.push(`/pagos?moneda=${currency}`)}>
              <Text style={{ color:'#DC2626', fontWeight:'600', fontSize:13 }}>Pagar tarjeta →</Text>
            </TouchableOpacity>
          </SectionCard>

          {/* ── Préstamos ── */}
          <SectionCard title="📋 Préstamos Activos" value={fmt(totalPrestamo)} color="#7C3AED">
            {prestamos.length === 0 ? (
              <Text style={styles.empty}>Sin préstamos activos. Toca ＋ para registrar uno.</Text>
            ) : prestamos.map((p, i) => {
              const cuotasPend = p.cuotas_estimadas != null ? Math.max(0, p.cuotas_estimadas - p.cuotas_pagadas) : null;
              return (
                <View key={p.id}>
                  <View style={styles.prodRow}>
                    <View style={{ flex:1 }}>
                      <Text style={styles.prodName}>{p.entidad_persona}</Text>
                      <Text style={styles.miniLabel}>
                        {p.tipo === 'recibido' ? 'Debo' : 'Me deben'} · cuota {fmt(Number(p.monto_mensual))}
                        {cuotasPend !== null ? ` · ${cuotasPend} cuotas` : ''}
                      </Text>
                    </View>
                    <Text style={[styles.prodAmount, { color:'#7C3AED' }]}>{fmt(Number(p.saldo_pendiente))}</Text>
                    <TouchableOpacity style={styles.editBtn} onPress={() => openEditPre(p)}>
                      <Text style={styles.editBtnText}>✎</Text>
                    </TouchableOpacity>
                  </View>
                  {i < prestamos.length - 1 && <View style={styles.rowSep} />}
                </View>
              );
            })}
            <TouchableOpacity style={styles.sectionFooter} onPress={() => router.push(`/prestamos?moneda=${currency}`)}>
              <Text style={{ color:'#7C3AED', fontWeight:'600', fontSize:13 }}>Registrar abono →</Text>
            </TouchableOpacity>
          </SectionCard>

          <View style={{ height: 100 }} />
        </ScrollView>
      )}

      {/* ── FAB ── */}
      <TouchableOpacity style={styles.fab} onPress={() => setShowFabMenu(true)} activeOpacity={0.85}>
        <Text style={styles.fabText}>＋</Text>
      </TouchableOpacity>

      {/* ── FAB Menú ── */}
      <Modal visible={showFabMenu} animationType="slide" transparent>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setShowFabMenu(false)}>
          <View style={styles.sheet}>
            <View style={styles.sheetPill} />
            <Text style={styles.sheetTitle}>Nuevo producto financiero</Text>
            <View style={styles.sheetDiv} />
            {[
              { icon:'💳', label:'Nueva Tarjeta de Crédito', sub:'Banco · Nombre · Línea · Deuda', bg:'#FEF3C7',
                fn: () => { setShowFabMenu(false); setTarForm({ banco:'', nombre:'', linea:'', deuda:'', dia_cierre:'' }); setTarError(''); setShowNewTar(true); } },
              { icon:'📋', label:'Nuevo Préstamo',           sub:'Entidad · Tipo · Monto · Cuota',  bg:'#EDE9FE',
                fn: () => { setShowFabMenu(false); setPreForm({ entidad:'', tipo:'recibido', monto_total:'', saldo:'', mensual:'' }); setPreError(''); setShowNewPre(true); } },
              { icon:'🏦', label:'Nueva Cuenta de Ahorro',   sub:'Nombre · Saldo inicial',          bg:'#E0F2FE',
                fn: () => { setShowFabMenu(false); setCueForm({ nombre:'', saldo:'' }); setCueError(''); setShowNewCue(true); } },
            ].map((opt, i, arr) => (
              <View key={opt.label}>
                <TouchableOpacity style={styles.sheetOpt} onPress={opt.fn}>
                  <View style={[styles.sheetOptIcon, { backgroundColor: opt.bg }]}>
                    <Text style={{ fontSize: 22 }}>{opt.icon}</Text>
                  </View>
                  <View style={{ flex:1 }}>
                    <Text style={styles.sheetOptTitle}>{opt.label}</Text>
                    <Text style={styles.sheetOptSub}>{opt.sub}</Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </TouchableOpacity>
                {i < arr.length - 1 && <View style={styles.sheetSep} />}
              </View>
            ))}
            <TouchableOpacity style={styles.sheetCancel} onPress={() => setShowFabMenu(false)}>
              <Text style={styles.sheetCancelText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Modal Nueva/Editar Tarjeta ── */}
      <Modal visible={showNewTar || !!editTar} animationType="slide" transparent>
        <View style={styles.formBackdrop}>
          <View style={styles.formSheet}>
            <View style={styles.formHead}>
              <Text style={styles.formTitle}>💳 {editTar ? 'Editar' : 'Nueva'} Tarjeta</Text>
              <TouchableOpacity onPress={() => { setShowNewTar(false); setEditTar(null); }}>
                <Text style={styles.formClose}>Cancelar</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.formBody} keyboardShouldPersistTaps="handled">
              {(['banco','nombre'] as const).map(field => (
                <View key={field}>
                  <Text style={styles.mLabel}>{field === 'banco' ? 'Banco *' : 'Nombre de tarjeta *'}</Text>
                  <TextInput style={styles.mInput} placeholderTextColor="#9CA3AF"
                    placeholder={field === 'banco' ? 'Ej: BCP, BBVA, Scotiabank' : 'Ej: Visa Clásica'}
                    value={tarForm[field]} onChangeText={v => setTarForm(s => ({ ...s, [field]: v }))} />
                </View>
              ))}
              <Text style={styles.mLabel}>Línea de Crédito</Text>
              <TextInput style={styles.mInput} keyboardType="decimal-pad" placeholder="5000.00"
                placeholderTextColor="#9CA3AF" value={tarForm.linea} onChangeText={v => setTarForm(s => ({ ...s, linea: v }))} />
              <Text style={styles.mLabel}>Deuda Vigente</Text>
              <TextInput style={styles.mInput} keyboardType="decimal-pad" placeholder="0.00"
                placeholderTextColor="#9CA3AF" value={tarForm.deuda} onChangeText={v => setTarForm(s => ({ ...s, deuda: v }))} />
              {(() => {
                const l = parseFloat(tarForm.linea)||0, d = parseFloat(tarForm.deuda)||0;
                return l > 0 ? (
                  <View style={styles.previewRow}>
                    <Text style={styles.previewLabel}>Disponible</Text>
                    <Text style={styles.previewVal}>{fmt(Math.max(0,l-d))}</Text>
                  </View>
                ) : null;
              })()}
              <Text style={styles.mLabel}>Día de cierre de ciclo <Text style={{ fontWeight:'400', color:'#9CA3AF' }}>(opcional, 1–31)</Text></Text>
              <TextInput
                style={styles.mInput}
                keyboardType="number-pad"
                placeholder="Ej: 7  (si tu tarjeta cierra el día 7)"
                placeholderTextColor="#9CA3AF"
                maxLength={2}
                value={tarForm.dia_cierre}
                onChangeText={v => setTarForm(s => ({ ...s, dia_cierre: v.replace(/\D/g,'').slice(0,2) }))}
              />
              {!!tarError && <Text style={styles.formError}>{tarError}</Text>}
              <TouchableOpacity style={[styles.formSaveBtn, tarSaving && { opacity:0.6 }]} onPress={handleSaveTar} disabled={tarSaving}>
                {tarSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.formSaveText}>{editTar ? 'Guardar cambios' : 'Crear Tarjeta'}</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Modal Nuevo/Editar Préstamo ── */}
      <Modal visible={showNewPre || !!editPre} animationType="slide" transparent>
        <View style={styles.formBackdrop}>
          <View style={styles.formSheet}>
            <View style={styles.formHead}>
              <Text style={styles.formTitle}>📋 {editPre ? 'Editar' : 'Nuevo'} Préstamo</Text>
              <TouchableOpacity onPress={() => { setShowNewPre(false); setEditPre(null); }}>
                <Text style={styles.formClose}>Cancelar</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.formBody} keyboardShouldPersistTaps="handled">
              {!editPre && (
                <>
                  <Text style={styles.mLabel}>Entidad / Persona *</Text>
                  <TextInput style={styles.mInput} placeholderTextColor="#9CA3AF"
                    placeholder="Ej: Banco BCP, Juan García"
                    value={preForm.entidad} onChangeText={v => setPreForm(s => ({ ...s, entidad: v }))} />
                  <Text style={styles.mLabel}>Tipo</Text>
                  <View style={styles.toggle}>
                    {(['recibido','otorgado'] as const).map(t => (
                      <TouchableOpacity key={t} style={[styles.toggleOpt, preForm.tipo===t && styles.toggleActive]}
                        onPress={() => setPreForm(s => ({ ...s, tipo: t }))}>
                        <Text style={[styles.toggleText, preForm.tipo===t && styles.toggleActiveText]}>
                          {t === 'recibido' ? 'Recibido (me prestaron)' : 'Otorgado (presté)'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={styles.mLabel}>Monto Total *</Text>
                  <TextInput style={styles.mInput} keyboardType="decimal-pad" placeholder="0.00"
                    placeholderTextColor="#9CA3AF" value={preForm.monto_total} onChangeText={v => setPreForm(s => ({ ...s, monto_total: v }))} />
                </>
              )}
              <Text style={styles.mLabel}>Saldo Pendiente {editPre ? '' : 'Inicial '}*</Text>
              <TextInput style={styles.mInput} keyboardType="decimal-pad" placeholder="0.00"
                placeholderTextColor="#9CA3AF" value={preForm.saldo} onChangeText={v => setPreForm(s => ({ ...s, saldo: v }))} />
              <Text style={styles.mLabel}>Cuota Mensual *</Text>
              <TextInput style={styles.mInput} keyboardType="decimal-pad" placeholder="0.00"
                placeholderTextColor="#9CA3AF" value={preForm.mensual} onChangeText={v => setPreForm(s => ({ ...s, mensual: v }))} />
              {!!preError && <Text style={styles.formError}>{preError}</Text>}
              <TouchableOpacity style={[styles.formSaveBtn, { backgroundColor:'#7C3AED' }, preSaving && { opacity:0.6 }]} onPress={handleSavePre} disabled={preSaving}>
                {preSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.formSaveText}>{editPre ? 'Guardar cambios' : 'Registrar Préstamo'}</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Modal Nueva/Editar Cuenta ── */}
      <Modal visible={showNewCue || !!editCue} animationType="slide" transparent>
        <View style={styles.formBackdrop}>
          <View style={styles.formSheet}>
            <View style={styles.formHead}>
              <Text style={styles.formTitle}>🏦 {editCue ? 'Editar' : 'Nueva'} Cuenta</Text>
              <TouchableOpacity onPress={() => { setShowNewCue(false); setEditCue(null); }}>
                <Text style={styles.formClose}>Cancelar</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.formBody}>
              <Text style={styles.mLabel}>Nombre de la cuenta *</Text>
              <TextInput style={styles.mInput} placeholderTextColor="#9CA3AF"
                placeholder="Ej: Fondo emergencia, Inversiones"
                value={cueForm.nombre} onChangeText={v => setCueForm(s => ({ ...s, nombre: v }))} />
              <Text style={styles.mLabel}>Saldo {editCue ? 'actual' : 'inicial de apertura'} *</Text>
              <TextInput style={styles.mInput} keyboardType="decimal-pad" placeholder="0.00"
                placeholderTextColor="#9CA3AF" value={cueForm.saldo} onChangeText={v => setCueForm(s => ({ ...s, saldo: v }))} />
              {!!cueError && <Text style={styles.formError}>{cueError}</Text>}
              <TouchableOpacity style={[styles.formSaveBtn, { backgroundColor:'#0891B2' }, cueSaving && { opacity:0.6 }]} onPress={handleSaveCue} disabled={cueSaving}>
                {cueSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.formSaveText}>{editCue ? 'Guardar cambios' : 'Crear Cuenta'}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header:  { flexDirection:'row', justifyContent:'space-between', alignItems:'center',
             paddingHorizontal:20, paddingTop: Platform.OS === 'android' ? 44 : 12, paddingBottom:12,
             borderBottomWidth:1, borderBottomColor:'#F3F4F6' },
  title:   { fontSize:20, fontWeight:'800', color:'#111827' },
  scroll:  { padding:16, paddingTop:12 },
  empty:   { fontSize:13, color:'#9CA3AF', paddingVertical:8 },
  divider: { height:1, backgroundColor:'#F3F4F6', marginVertical:12 },
  rowSep:  { height:1, backgroundColor:'#F3F4F6' },

  sectionCard:     { backgroundColor:'#fff', borderRadius:16, padding:16, marginBottom:16,
                     borderLeftWidth:4, shadowColor:'#000', shadowOpacity:0.04, shadowRadius:6, elevation:1 },
  sectionCardHead: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:4 },
  sectionCardTitle:{ fontSize:14, fontWeight:'700' },
  sectionCardTotal:{ fontSize:16, fontWeight:'800' },
  sectionFooter:   { marginTop:12, alignSelf:'flex-start' },

  prodRow:   { flexDirection:'row', alignItems:'center', paddingVertical:10, gap:10 },
  prodName:  { fontSize:14, fontWeight:'600', color:'#111827' },
  prodAmount:{ fontSize:14, fontWeight:'700', color:'#374151', flexShrink:0 },

  tarjetaCard: { flexDirection:'row', alignItems:'center', paddingVertical:10, gap:10 },
  bankBadge:   { width:40, height:28, borderRadius:6, justifyContent:'center', alignItems:'center', flexShrink:0 },
  bankBadgeText:{ color:'#fff', fontSize:10, fontWeight:'800', letterSpacing:0.3 },
  barBg:       { height:4, backgroundColor:'#F3F4F6', borderRadius:2, overflow:'hidden', marginTop:6 },
  barFill:     { height:'100%', borderRadius:2 },
  miniLabel:   { fontSize:10, color:'#9CA3AF', marginTop:2 },

  editBtn:     { width:32, height:32, borderRadius:8, backgroundColor:'#F3F4F6', justifyContent:'center', alignItems:'center', flexShrink:0 },
  editBtnText: { fontSize:15, color:'#6B7280' },

  cicloBox:        { backgroundColor:'#FFF7F7', borderRadius:10, padding:10, marginBottom:8 },
  cicloTitle:      { fontSize:10, fontWeight:'700', color:'#DC2626', textTransform:'uppercase', letterSpacing:0.5, marginBottom:8 },
  cicloRow:        { flexDirection:'row', alignItems:'flex-end', gap:6 },
  cicloField:      { flex:1 },
  cicloFieldLabel: { fontSize:10, fontWeight:'600', color:'#6B7280', marginBottom:3 },
  cicloInput:      { height:36, backgroundColor:'#fff', borderWidth:1, borderColor:'#FCA5A5', borderRadius:8, paddingHorizontal:8, fontSize:12, color:'#111827' },
  cicloCalcBtn:    { height:36, backgroundColor:'#DC2626', borderRadius:8, paddingHorizontal:10, justifyContent:'center', alignItems:'center' },
  cicloCalcText:   { fontSize:12, fontWeight:'700', color:'#fff' },
  cicloResult:     { flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginTop:10 },
  cicloTotal:      { fontSize:18, fontWeight:'800', color:'#111827' },
  cicloSub:        { fontSize:10, color:'#9CA3AF', marginTop:1 },
  cicloBtn:        { backgroundColor:'#DC2626', borderRadius:8, paddingHorizontal:10, paddingVertical:7, alignItems:'center' },
  cicloBtnText:    { fontSize:10, fontWeight:'700', color:'#fff', textAlign:'center' },

  fab:     { position:'absolute', bottom:24, right:20, width:56, height:56, borderRadius:28,
             backgroundColor:'#3B82F6', justifyContent:'center', alignItems:'center',
             shadowColor:'#3B82F6', shadowOffset:{ width:0, height:4 }, shadowOpacity:0.4, shadowRadius:8, elevation:8 },
  fabText: { color:'#fff', fontSize:28, lineHeight:32, fontWeight:'300' },

  backdrop:       { flex:1, backgroundColor:'rgba(0,0,0,0.45)', justifyContent:'flex-end' },
  sheet:          { backgroundColor:'#fff', borderTopLeftRadius:28, borderTopRightRadius:28,
                    paddingBottom: Platform.OS === 'ios' ? 36 : 20 },
  sheetPill:      { width:40, height:4, backgroundColor:'#E5E7EB', borderRadius:2, alignSelf:'center', marginTop:10, marginBottom:16 },
  sheetTitle:     { fontSize:16, fontWeight:'700', color:'#111827', paddingHorizontal:20, marginBottom:12 },
  sheetDiv:       { height:1, backgroundColor:'#F3F4F6' },
  sheetOpt:       { flexDirection:'row', alignItems:'center', paddingHorizontal:20, paddingVertical:14, gap:14 },
  sheetOptIcon:   { width:48, height:48, borderRadius:14, justifyContent:'center', alignItems:'center' },
  sheetOptTitle:  { fontSize:15, fontWeight:'600', color:'#111827' },
  sheetOptSub:    { fontSize:12, color:'#9CA3AF', marginTop:2 },
  chevron:        { fontSize:22, color:'#D1D5DB' },
  sheetSep:       { height:1, backgroundColor:'#F3F4F6', marginLeft:82 },
  sheetCancel:    { margin:16, backgroundColor:'#F3F4F6', borderRadius:14, paddingVertical:14, alignItems:'center' },
  sheetCancelText:{ fontSize:15, fontWeight:'600', color:'#374151' },

  formBackdrop: { flex:1, backgroundColor:'rgba(0,0,0,0.45)', justifyContent:'flex-end', alignItems:'center' },
  formSheet:    { backgroundColor:'#fff', borderTopLeftRadius:24, borderTopRightRadius:24, width:'100%', maxWidth:600, maxHeight:'88%' },
  formHead:     { flexDirection:'row', justifyContent:'space-between', alignItems:'center',
                  paddingHorizontal:20, paddingVertical:16, borderBottomWidth:1, borderBottomColor:'#F3F4F6' },
  formTitle:    { fontSize:16, fontWeight:'700', color:'#111827' },
  formClose:    { fontSize:14, color:'#3B82F6', fontWeight:'500' },
  formBody:     { padding:20, paddingBottom:40 },
  mLabel:       { fontSize:13, fontWeight:'500', color:'#374151', marginBottom:6, marginTop:14 },
  mInput:       { height:50, backgroundColor:'#F9FAFB', borderWidth:1, borderColor:'#E5E7EB',
                  borderRadius:12, paddingHorizontal:14, fontSize:15, color:'#111827' },
  formError:    { color:'#DC2626', fontSize:13, marginTop:8, backgroundColor:'#FEF2F2', borderRadius:8, padding:10 },
  formSaveBtn:  { height:50, backgroundColor:'#3B82F6', borderRadius:12, justifyContent:'center', alignItems:'center', marginTop:20 },
  formSaveText: { color:'#fff', fontSize:15, fontWeight:'600' },
  previewRow:   { flexDirection:'row', justifyContent:'space-between', alignItems:'center',
                  backgroundColor:'#F0FDF4', borderRadius:10, padding:12, marginTop:8 },
  previewLabel: { fontSize:13, color:'#374151' },
  previewVal:   { fontSize:13, fontWeight:'700', color:'#059669' },
  toggle:       { flexDirection:'row', backgroundColor:'#F3F4F6', borderRadius:10, padding:3, marginBottom:4 },
  toggleOpt:    { flex:1, paddingVertical:9, borderRadius:8, alignItems:'center' },
  toggleActive: { backgroundColor:'#fff', shadowColor:'#000', shadowOpacity:0.06, shadowRadius:3, elevation:1 },
  toggleText:   { fontSize:12, fontWeight:'500', color:'#6B7280' },
  toggleActiveText:{ color:'#111827', fontWeight:'600' },
});
