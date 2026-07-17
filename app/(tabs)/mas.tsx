import { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Platform, ActivityIndicator, ScrollView, SafeAreaView,
  Modal, TextInput, Switch,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { T, R, MAXW } from '@/theme';

interface Profile {
  id: string;
  nombre: string;
  email: string;
  moneda_base: string;
  modulo_ahorros: boolean;
  modulo_prestamos: boolean;
  modulo_tarjetas: boolean;
}

const MONEDAS = [
  { code: 'PEN', label: 'Sol peruano',          flag: '🇵🇪' },
  { code: 'USD', label: 'Dólar estadounidense', flag: '🇺🇸' },
  { code: 'EUR', label: 'Euro',                 flag: '🇪🇺' },
  { code: 'MXN', label: 'Peso mexicano',        flag: '🇲🇽' },
  { code: 'COP', label: 'Peso colombiano',      flag: '🇨🇴' },
  { code: 'ARS', label: 'Peso argentino',       flag: '🇦🇷' },
  { code: 'BRL', label: 'Real brasileño',       flag: '🇧🇷' },
  { code: 'CLP', label: 'Peso chileno',         flag: '🇨🇱' },
];

export default function Mas() {
  const [profile,            setProfile]            = useState<Profile | null>(null);
  const [loading,            setLoading]            = useState(true);
  const [showMonedas,        setShowMonedas]        = useState(false);
  const [savingMoneda,       setSavingMoneda]       = useState(false);
  const [showEditName,       setShowEditName]       = useState(false);
  const [editName,           setEditName]           = useState('');
  const [savingName,         setSavingName]         = useState(false);
  const [savingAhorros,      setSavingAhorros]      = useState(false);
  const [savingPrestamos,    setSavingPrestamos]    = useState(false);
  const [savingTarjetas,     setSavingTarjetas]     = useState(false);
  const [loggingOut,         setLoggingOut]         = useState(false);
  const [showLogoutConfirm,  setShowLogoutConfirm]  = useState(false);

  // Cambio de contraseña
  const [showChangePass,     setShowChangePass]     = useState(false);
  const [newPass,            setNewPass]            = useState('');
  const [confirmPass,        setConfirmPass]        = useState('');
  const [passError,          setPassError]          = useState('');
  const [passSuccess,        setPassSuccess]        = useState(false);
  const [savingPass,         setSavingPass]         = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !active) return;
        const { data } = await supabase
          .from('profiles')
          .select('id,nombre,moneda_base,modulo_ahorros,modulo_prestamos,modulo_tarjetas')
          .eq('id', user.id)
          .single();
        if (active && data) {
          setProfile({
            ...(data as any),
            modulo_tarjetas: (data as any).modulo_tarjetas ?? true,
            email: user.email ?? '',
          });
        }
        setLoading(false);
      })();
      return () => { active = false; };
    }, [])
  );

  const handleChangeMoneda = async (code: string) => {
    if (!profile || code === profile.moneda_base) { setShowMonedas(false); return; }
    setSavingMoneda(true);
    await supabase.from('profiles').update({ moneda_base: code }).eq('id', profile.id);
    setProfile(p => p ? { ...p, moneda_base: code } : p);
    setShowMonedas(false);
    setSavingMoneda(false);
  };

  const handleSaveName = async () => {
    if (!editName.trim() || !profile) return;
    setSavingName(true);
    await supabase.from('profiles').update({ nombre: editName.trim() }).eq('id', profile.id);
    setProfile(p => p ? { ...p, nombre: editName.trim() } : p);
    setShowEditName(false);
    setSavingName(false);
  };

  const handleToggleAhorros = async (val: boolean) => {
    if (!profile) return;
    setSavingAhorros(true);
    await supabase.from('profiles').update({ modulo_ahorros: val }).eq('id', profile.id);
    setProfile(p => p ? { ...p, modulo_ahorros: val } : p);
    setSavingAhorros(false);
  };

  const handleTogglePrestamos = async (val: boolean) => {
    if (!profile) return;
    setSavingPrestamos(true);
    await supabase.from('profiles').update({ modulo_prestamos: val }).eq('id', profile.id);
    setProfile(p => p ? { ...p, modulo_prestamos: val } : p);
    setSavingPrestamos(false);
  };

  const handleToggleTarjetas = async (val: boolean) => {
    if (!profile) return;
    setSavingTarjetas(true);
    await supabase.from('profiles').update({ modulo_tarjetas: val }).eq('id', profile.id);
    setProfile(p => p ? { ...p, modulo_tarjetas: val } : p);
    setSavingTarjetas(false);
  };

  const handleChangePassword = async () => {
    setPassError('');
    if (newPass.length < 6) { setPassError('La contraseña debe tener al menos 6 caracteres.'); return; }
    if (newPass !== confirmPass) { setPassError('Las contraseñas no coinciden.'); return; }
    setSavingPass(true);
    const { error } = await supabase.auth.updateUser({ password: newPass });
    setSavingPass(false);
    if (error) { setPassError(error.message); return; }
    setPassSuccess(true);
    setNewPass('');
    setConfirmPass('');
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    await supabase.auth.signOut();
    router.replace('/(auth)/login');
  };

  const monedaInfo = MONEDAS.find(m => m.code === profile?.moneda_base) ?? MONEDAS[0];
  const initial    = profile?.nombre?.charAt(0).toUpperCase() ?? '?';

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: T.screen }}>
        <ActivityIndicator color={T.accent} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: T.screen }}>
      <SafeAreaView style={{ backgroundColor: T.screen }}>
        <View style={s.header}>
          <Text style={s.title}>Configuración</Text>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Avatar / Perfil ── */}
        <View style={s.profileCard}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{initial}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.profileName}>{profile?.nombre ?? '—'}</Text>
            <Text style={s.profileEmail}>{profile?.email ?? '—'}</Text>
          </View>
          <TouchableOpacity
            style={s.editBtn}
            onPress={() => { setEditName(profile?.nombre ?? ''); setShowEditName(true); }}
          >
            <Text style={s.editBtnText}>✎ Editar</Text>
          </TouchableOpacity>
        </View>

        {/* ── Preferencias ── */}
        <SLabel>PREFERENCIAS</SLabel>
        <View style={s.group}>
          <TouchableOpacity style={s.row} onPress={() => setShowMonedas(true)}>
            <Text style={s.rowIcon}>💱</Text>
            <View style={s.rowBody}>
              <Text style={s.rowTitle}>Moneda base</Text>
              <Text style={s.rowSub}>{monedaInfo.flag} {monedaInfo.code} — {monedaInfo.label}</Text>
            </View>
            <Text style={s.rowChevron}>›</Text>
          </TouchableOpacity>

          <View style={s.sep} />

          <TouchableOpacity style={s.row} onPress={() => { setPassError(''); setPassSuccess(false); setNewPass(''); setConfirmPass(''); setShowChangePass(true); }}>
            <Text style={s.rowIcon}>🔑</Text>
            <View style={s.rowBody}>
              <Text style={s.rowTitle}>Cambiar contraseña</Text>
              <Text style={s.rowSub}>Actualiza tu contraseña de acceso</Text>
            </View>
            <Text style={s.rowChevron}>›</Text>
          </TouchableOpacity>
        </View>

        {/* ── Módulos activables ── */}
        <SLabel>MÓDULOS</SLabel>
        <Text style={s.sectionHint}>
          Activa solo los módulos que necesitas. La interfaz se adapta automáticamente.
        </Text>
        <View style={s.group}>

          <View style={s.row}>
            <Text style={s.rowIcon}>🏦</Text>
            <View style={s.rowBody}>
              <Text style={s.rowTitle}>Ahorros & Inversiones</Text>
              <Text style={s.rowSub}>{profile?.modulo_ahorros ? 'Activo — visible en Dashboard' : 'Inactivo'}</Text>
            </View>
            {savingAhorros
              ? <ActivityIndicator size="small" color={T.accent} />
              : <Switch value={profile?.modulo_ahorros ?? false} onValueChange={handleToggleAhorros}
                  trackColor={{ false: T.inputBorder, true: T.accentSoft }}
                  thumbColor={profile?.modulo_ahorros ? T.accent : T.textMicro} />}
          </View>

          <View style={s.sep} />

          <View style={s.row}>
            <Text style={s.rowIcon}>📋</Text>
            <View style={s.rowBody}>
              <Text style={s.rowTitle}>Préstamos y Créditos</Text>
              <Text style={s.rowSub}>{profile?.modulo_prestamos ? 'Activo — gestión de deudas' : 'Inactivo'}</Text>
            </View>
            {savingPrestamos
              ? <ActivityIndicator size="small" color={T.accent} />
              : <Switch value={profile?.modulo_prestamos ?? false} onValueChange={handleTogglePrestamos}
                  trackColor={{ false: T.inputBorder, true: T.accentSoft }}
                  thumbColor={profile?.modulo_prestamos ? T.accent : T.textMicro} />}
          </View>

          <View style={s.sep} />

          <View style={s.row}>
            <Text style={s.rowIcon}>💳</Text>
            <View style={s.rowBody}>
              <Text style={s.rowTitle}>Tarjetas de Crédito</Text>
              <Text style={s.rowSub}>{profile?.modulo_tarjetas !== false ? 'Activo — pagos y saldos visibles' : 'Inactivo — módulo oculto'}</Text>
            </View>
            {savingTarjetas
              ? <ActivityIndicator size="small" color={T.accent} />
              : <Switch value={profile?.modulo_tarjetas !== false} onValueChange={handleToggleTarjetas}
                  trackColor={{ false: T.inputBorder, true: T.accentSoft }}
                  thumbColor={profile?.modulo_tarjetas !== false ? T.accent : T.textMicro} />}
          </View>
        </View>

        {/* ── Accesos rápidos ── */}
        <SLabel>ACCESOS RÁPIDOS</SLabel>
        <View style={s.group}>
          {[
            { icon: '📊', label: 'Historial completo',    sub: 'Buscar y filtrar transacciones',   fn: () => router.push('/historial') },
            { icon: '🔄', label: 'Compromisos Fijos',    sub: 'Recurrentes y cuotas del mes',     fn: () => router.push('/compromisos') },
            { icon: '💸', label: 'Gestionar Deudas',    sub: 'Editar recurrentes y cuotas',       fn: () => router.push('/gestionar-deudas') },
            { icon: '🏷️', label: 'Gestionar Categorías', sub: 'Añadir categorías y subcategorías',fn: () => router.push('/gestionar-categorias') },
            { icon: '📈', label: 'Análisis financiero',   sub: 'Comparativo mensual y tendencias', fn: () => router.push('/(tabs)/analisis') },
            ...(profile?.modulo_tarjetas !== false || profile?.modulo_prestamos ? [{ icon: '💳', label: 'Pagos de tarjetas', sub: 'Registrar pagos a deudas', fn: () => router.push(`/pagos?moneda=${profile?.moneda_base ?? 'PEN'}`) }] : []),
            ...(profile?.modulo_prestamos ? [{ icon: '📋', label: 'Gestión de préstamos', sub: 'Abonos y seguimiento', fn: () => router.push(`/prestamos?moneda=${profile?.moneda_base ?? 'PEN'}`) }] : []),
            ...(profile?.modulo_ahorros   ? [{ icon: '🏦', label: 'Ahorros & Inversiones', sub: 'Movimientos de cuentas', fn: () => router.push(`/ahorros?moneda=${profile?.moneda_base ?? 'PEN'}`) }] : []),
          ].map((item, i, arr) => (
            <View key={item.label}>
              <TouchableOpacity style={s.row} onPress={item.fn}>
                <Text style={s.rowIcon}>{item.icon}</Text>
                <View style={s.rowBody}>
                  <Text style={s.rowTitle}>{item.label}</Text>
                  <Text style={s.rowSub}>{item.sub}</Text>
                </View>
                <Text style={s.rowChevron}>›</Text>
              </TouchableOpacity>
              {i < arr.length - 1 && <View style={s.sep} />}
            </View>
          ))}
        </View>

        {/* ── Sesión ── */}
        <SLabel>SESIÓN</SLabel>
        <View style={s.group}>
          <TouchableOpacity style={s.row} onPress={() => setShowLogoutConfirm(true)}>
            <Text style={s.rowIcon}>🚪</Text>
            <View style={s.rowBody}>
              <Text style={[s.rowTitle, { color: T.red }]}>Cerrar sesión</Text>
              <Text style={s.rowSub}>Salir de la cuenta</Text>
            </View>
          </TouchableOpacity>
        </View>

        <View style={{ height: 60 }} />
      </ScrollView>

      {/* ── Moneda Picker ── */}
      <Modal visible={showMonedas} animationType="slide" transparent>
        <View style={s.modalBg}>
          <View style={[s.modalSheet, { maxHeight: '70%' }]}>
            <View style={s.modalHead}>
              <Text style={s.modalTitle}>Moneda base</Text>
              <TouchableOpacity onPress={() => setShowMonedas(false)}>
                <Text style={s.modalClose}>Cerrar</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              {MONEDAS.map((m, i) => (
                <View key={m.code}>
                  <TouchableOpacity style={s.monedaOpt} onPress={() => handleChangeMoneda(m.code)} disabled={savingMoneda}>
                    <Text style={s.monedaFlag}>{m.flag}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.monedaCode}>{m.code}</Text>
                      <Text style={s.monedaLbl}>{m.label}</Text>
                    </View>
                    {profile?.moneda_base === m.code && <Text style={{ color: T.accent, fontSize: 18 }}>✓</Text>}
                  </TouchableOpacity>
                  {i < MONEDAS.length - 1 && <View style={s.sep} />}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Editar nombre ── */}
      <Modal visible={showEditName} animationType="slide" transparent>
        <View style={s.modalBg}>
          <View style={s.modalSheet}>
            <View style={s.modalHead}>
              <Text style={s.modalTitle}>Editar nombre</Text>
              <TouchableOpacity onPress={() => setShowEditName(false)}>
                <Text style={s.modalClose}>Cancelar</Text>
              </TouchableOpacity>
            </View>
            <View style={s.formBody}>
              <Text style={s.mLabel}>Nombre</Text>
              <TextInput style={s.mInput} value={editName} onChangeText={setEditName}
                autoFocus placeholderTextColor={T.textMicro} />
              <TouchableOpacity style={[s.saveBtn, savingName && { opacity: 0.6 }]} onPress={handleSaveName} disabled={savingName}>
                {savingName ? <ActivityIndicator color="#fff" /> : <Text style={s.saveBtnText}>Guardar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Cambiar contraseña ── */}
      <Modal visible={showChangePass} animationType="slide" transparent>
        <View style={s.modalBg}>
          <View style={s.modalSheet}>
            <View style={s.modalHead}>
              <Text style={s.modalTitle}>🔑 Cambiar contraseña</Text>
              <TouchableOpacity onPress={() => { setShowChangePass(false); setPassSuccess(false); }}>
                <Text style={s.modalClose}>Cancelar</Text>
              </TouchableOpacity>
            </View>
            <View style={s.formBody}>
              {passSuccess ? (
                <View style={s.successBox}>
                  <Text style={s.successIcon}>✅</Text>
                  <Text style={s.successText}>¡Contraseña actualizada correctamente!</Text>
                  <TouchableOpacity style={s.saveBtn} onPress={() => setShowChangePass(false)}>
                    <Text style={s.saveBtnText}>Listo</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <Text style={s.mLabel}>Nueva contraseña</Text>
                  <TextInput style={s.mInput} value={newPass} onChangeText={setNewPass}
                    secureTextEntry placeholder="Mínimo 6 caracteres" placeholderTextColor={T.textMicro} />
                  <Text style={[s.mLabel, { marginTop: 12 }]}>Confirmar contraseña</Text>
                  <TextInput style={s.mInput} value={confirmPass} onChangeText={setConfirmPass}
                    secureTextEntry placeholder="Repite la contraseña" placeholderTextColor={T.textMicro} />
                  {!!passError && (
                    <View style={s.errBox}>
                      <Text style={s.errText}>{passError}</Text>
                    </View>
                  )}
                  <TouchableOpacity style={[s.saveBtn, savingPass && { opacity: 0.6 }]} onPress={handleChangePassword} disabled={savingPass}>
                    {savingPass ? <ActivityIndicator color="#fff" /> : <Text style={s.saveBtnText}>Actualizar contraseña</Text>}
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Logout confirm ── */}
      <Modal visible={showLogoutConfirm} animationType="fade" transparent>
        <View style={s.confirmBg}>
          <View style={s.confirmBox}>
            <Text style={s.confirmTitle}>¿Cerrar sesión?</Text>
            <Text style={s.confirmSub}>Podrás volver a iniciar sesión con tu cuenta.</Text>
            <View style={s.confirmBtns}>
              <TouchableOpacity style={s.confirmCancel} onPress={() => setShowLogoutConfirm(false)}>
                <Text style={s.confirmCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.confirmDanger, loggingOut && { opacity: 0.6 }]} onPress={handleLogout} disabled={loggingOut}>
                {loggingOut ? <ActivityIndicator color="#fff" /> : <Text style={s.confirmDangerText}>Cerrar sesión</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function SLabel({ children }: { children: string }) {
  return <Text style={s.sectionLabel}>{children}</Text>;
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: Platform.OS === 'android' ? 44 : 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: T.border },
  title:  { fontSize: 20, fontWeight: '800', color: T.textPrimary },
  scroll: { padding: 16, width: '100%', maxWidth: MAXW, alignSelf: 'center' },

  sectionLabel: { fontSize: 11, fontWeight: '700', color: T.textMicro, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6, marginTop: 16, marginLeft: 4 },
  sectionHint:  { fontSize: 12, color: T.textMicro, marginBottom: 8, marginLeft: 4, lineHeight: 17 },

  group:      { backgroundColor: T.card, borderRadius: R.card, overflow: 'hidden', borderWidth: 1, borderColor: T.border },
  row:        { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  rowIcon:    { fontSize: 22, width: 28, textAlign: 'center' },
  rowBody:    { flex: 1, minWidth: 0 },
  rowTitle:   { fontSize: 15, fontWeight: '600', color: T.textPrimary },
  rowSub:     { fontSize: 12, color: T.textMicro, marginTop: 1 },
  rowChevron: { fontSize: 22, color: T.inputBorder },
  sep:        { height: 1, backgroundColor: T.border, marginLeft: 56 },

  profileCard:  { backgroundColor: T.card, borderRadius: R.card, padding: 16, marginBottom: 4, flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: T.border },
  avatar:       { width: 52, height: 52, borderRadius: 26, backgroundColor: T.accent, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  avatarText:   { color: '#fff', fontSize: 22, fontWeight: '700' },
  profileName:  { fontSize: 17, fontWeight: '700', color: T.textPrimary },
  profileEmail: { fontSize: 13, color: T.textMicro, marginTop: 2 },
  editBtn:      { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: T.screen, borderRadius: 8 },
  editBtnText:  { fontSize: 12, color: T.textSec, fontWeight: '500' },

  modalBg:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end', alignItems: 'center' },
  modalSheet: { backgroundColor: T.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, width: '100%', maxWidth: MAXW, maxHeight: '80%' },
  modalHead:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: T.border },
  modalTitle: { fontSize: 16, fontWeight: '700', color: T.textPrimary },
  modalClose: { fontSize: 14, color: T.accent, fontWeight: '500' },
  monedaOpt:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 14 },
  monedaFlag: { fontSize: 24 },
  monedaCode: { fontSize: 15, fontWeight: '600', color: T.textPrimary },
  monedaLbl:  { fontSize: 12, color: T.textMicro },

  formBody:    { padding: 20, paddingBottom: 36 },
  mLabel:      { fontSize: 13, fontWeight: '500', color: T.textSec, marginBottom: 8 },
  mInput:      { height: 50, backgroundColor: T.input, borderWidth: 1, borderColor: T.inputBorder, borderRadius: R.control, paddingHorizontal: 14, fontSize: 15, color: T.textPrimary, marginBottom: 4 },
  saveBtn:     { height: 50, backgroundColor: T.accent, borderRadius: R.control, justifyContent: 'center', alignItems: 'center', marginTop: 16 },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  errBox:  { backgroundColor: T.redSoft, borderRadius: 8, padding: 10, marginTop: 10 },
  errText: { color: T.red, fontSize: 13 },

  successBox:  { alignItems: 'center', paddingVertical: 20 },
  successIcon: { fontSize: 40, marginBottom: 12 },
  successText: { fontSize: 15, color: T.textSec, textAlign: 'center', marginBottom: 20, lineHeight: 22 },

  confirmBg:         { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  confirmBox:        { backgroundColor: T.card, borderRadius: 20, padding: 24, width: '100%', maxWidth: 340 },
  confirmTitle:      { fontSize: 17, fontWeight: '700', color: T.textPrimary, marginBottom: 8 },
  confirmSub:        { fontSize: 14, color: T.textSec, lineHeight: 20, marginBottom: 20 },
  confirmBtns:       { flexDirection: 'row', gap: 10 },
  confirmCancel:     { flex: 1, height: 46, backgroundColor: T.screen, borderRadius: R.control, justifyContent: 'center', alignItems: 'center' },
  confirmCancelText: { fontSize: 15, color: T.textSec, fontWeight: '500' },
  confirmDanger:     { flex: 1, height: 46, backgroundColor: T.red, borderRadius: R.control, justifyContent: 'center', alignItems: 'center' },
  confirmDangerText: { fontSize: 15, color: '#fff', fontWeight: '600' },
});
