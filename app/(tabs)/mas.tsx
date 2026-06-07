import { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Platform, ActivityIndicator, ScrollView, SafeAreaView, Modal, TextInput,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';

interface Profile { id: string; nombre: string; email: string; moneda_base: string }

const MONEDAS = [
  { code:'PEN', label:'Sol peruano', flag:'🇵🇪' },
  { code:'USD', label:'Dólar estadounidense', flag:'🇺🇸' },
  { code:'EUR', label:'Euro', flag:'🇪🇺' },
  { code:'MXN', label:'Peso mexicano', flag:'🇲🇽' },
  { code:'COP', label:'Peso colombiano', flag:'🇨🇴' },
  { code:'ARS', label:'Peso argentino', flag:'🇦🇷' },
  { code:'BRL', label:'Real brasileño', flag:'🇧🇷' },
  { code:'CLP', label:'Peso chileno', flag:'🇨🇱' },
];

export default function Mas() {
  const [profile,        setProfile]        = useState<Profile|null>(null);
  const [loading,        setLoading]        = useState(true);
  const [showMonedas,    setShowMonedas]    = useState(false);
  const [savingMoneda,   setSavingMoneda]   = useState(false);
  const [showEditName,   setShowEditName]   = useState(false);
  const [editName,       setEditName]       = useState('');
  const [savingName,     setSavingName]     = useState(false);
  const [loggingOut,     setLoggingOut]     = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        setLoading(true);
        const { data:{ user } } = await supabase.auth.getUser();
        if (!user || !active) return;
        const { data } = await supabase.from('profiles').select('id,nombre,moneda_base').eq('id', user.id).single();
        if (active && data) setProfile({ ...(data as any), email: user.email ?? '' });
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

  const handleLogout = async () => {
    setLoggingOut(true);
    await supabase.auth.signOut();
    router.replace('/(auth)/login');
  };

  const monedaInfo = MONEDAS.find(m => m.code === profile?.moneda_base) ?? MONEDAS[0];

  if (loading) {
    return (
      <View style={{ flex:1, justifyContent:'center', alignItems:'center', backgroundColor:'#F8F9FB' }}>
        <ActivityIndicator color="#3B82F6" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#F8F9FB' }}>
      <SafeAreaView style={{ backgroundColor: '#F8F9FB' }}>
        <View style={styles.header}>
          <Text style={styles.title}>Configuración</Text>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Perfil ── */}
        <View style={styles.profileCard}>
          <View style={styles.profileAvatar}>
            <Text style={styles.profileAvatarText}>
              {profile?.nombre?.charAt(0).toUpperCase() ?? '?'}
            </Text>
          </View>
          <View style={{ flex:1 }}>
            <Text style={styles.profileName}>{profile?.nombre ?? '—'}</Text>
            <Text style={styles.profileEmail}>{profile?.email ?? '—'}</Text>
          </View>
          <TouchableOpacity
            style={styles.editNameBtn}
            onPress={() => { setEditName(profile?.nombre ?? ''); setShowEditName(true); }}
          >
            <Text style={styles.editNameText}>✎ Editar</Text>
          </TouchableOpacity>
        </View>

        {/* ── Preferencias ── */}
        <Text style={styles.sectionLabel}>PREFERENCIAS</Text>
        <View style={styles.group}>
          <TouchableOpacity style={styles.row} onPress={() => setShowMonedas(true)}>
            <Text style={styles.rowIcon}>💱</Text>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>Moneda base</Text>
              <Text style={styles.rowSub}>{monedaInfo.flag} {monedaInfo.code} — {monedaInfo.label}</Text>
            </View>
            <Text style={styles.rowChevron}>›</Text>
          </TouchableOpacity>
        </View>

        {/* ── Módulos ── */}
        <Text style={styles.sectionLabel}>MÓDULOS</Text>
        <View style={styles.group}>
          {[
            { icon:'📜', label:'Historial completo', sub:'Buscar y filtrar transacciones', fn: () => router.push('/historial') },
            { icon:'💳', label:'Pagos de tarjetas', sub:'Registrar pagos a deudas', fn: () => router.push(`/pagos?moneda=${profile?.moneda_base ?? 'PEN'}`) },
            { icon:'📋', label:'Gestión de préstamos', sub:'Abonos y seguimiento', fn: () => router.push(`/prestamos?moneda=${profile?.moneda_base ?? 'PEN'}`) },
            { icon:'🏦', label:'Ahorros & Inversiones', sub:'Movimientos de cuentas de ahorro', fn: () => router.push(`/ahorros?moneda=${profile?.moneda_base ?? 'PEN'}`) },
          ].map((item, i, arr) => (
            <View key={item.label}>
              <TouchableOpacity style={styles.row} onPress={item.fn}>
                <Text style={styles.rowIcon}>{item.icon}</Text>
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>{item.label}</Text>
                  <Text style={styles.rowSub}>{item.sub}</Text>
                </View>
                <Text style={styles.rowChevron}>›</Text>
              </TouchableOpacity>
              {i < arr.length - 1 && <View style={styles.sep} />}
            </View>
          ))}
        </View>

        {/* ── Base de datos ── */}
        <Text style={styles.sectionLabel}>BASE DE DATOS</Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <Text style={styles.rowIcon}>⚙️</Text>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>Migraciones SQL</Text>
              <Text style={styles.rowSub}>migration_v3.sql y migration_v3_patch.sql pendientes de ejecutar en Supabase SQL Editor para corregir triggers duplicados.</Text>
            </View>
          </View>
        </View>

        {/* ── Sesión ── */}
        <Text style={styles.sectionLabel}>SESIÓN</Text>
        <View style={styles.group}>
          <TouchableOpacity style={styles.row} onPress={() => setShowLogoutConfirm(true)}>
            <Text style={styles.rowIcon}>🚪</Text>
            <View style={styles.rowBody}>
              <Text style={[styles.rowTitle, { color:'#DC2626' }]}>Cerrar sesión</Text>
              <Text style={styles.rowSub}>Salir de la cuenta</Text>
            </View>
          </TouchableOpacity>
        </View>

        <View style={{ height: 60 }} />
      </ScrollView>

      {/* ── Moneda Picker ── */}
      <Modal visible={showMonedas} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { maxHeight:'70%' }]}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Moneda base</Text>
              <TouchableOpacity onPress={() => setShowMonedas(false)}>
                <Text style={styles.modalClose}>Cerrar</Text>
              </TouchableOpacity>
            </View>
            {MONEDAS.map((m, i) => (
              <View key={m.code}>
                <TouchableOpacity
                  style={styles.monedaOpt}
                  onPress={() => handleChangeMoneda(m.code)}
                  disabled={savingMoneda}
                >
                  <Text style={styles.monedaFlag}>{m.flag}</Text>
                  <View style={{ flex:1 }}>
                    <Text style={styles.monedaCode}>{m.code}</Text>
                    <Text style={styles.monedaLabel}>{m.label}</Text>
                  </View>
                  {profile?.moneda_base === m.code && <Text style={{ color:'#3B82F6', fontSize:18 }}>✓</Text>}
                </TouchableOpacity>
                {i < MONEDAS.length - 1 && <View style={styles.sep} />}
              </View>
            ))}
          </View>
        </View>
      </Modal>

      {/* ── Edit nombre ── */}
      <Modal visible={showEditName} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Editar nombre</Text>
              <TouchableOpacity onPress={() => setShowEditName(false)}>
                <Text style={styles.modalClose}>Cancelar</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.formBody}>
              <Text style={styles.mLabel}>Nombre</Text>
              <TextInput
                style={styles.mInput}
                value={editName}
                onChangeText={setEditName}
                autoFocus
                placeholderTextColor="#9CA3AF"
              />
              <TouchableOpacity
                style={[styles.saveBtn, savingName && { opacity:0.6 }]}
                onPress={handleSaveName}
                disabled={savingName}
              >
                {savingName ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Guardar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Logout confirm ── */}
      <Modal visible={showLogoutConfirm} animationType="fade" transparent>
        <View style={styles.confirmBackdrop}>
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitle}>¿Cerrar sesión?</Text>
            <Text style={styles.confirmSub}>Podrás volver a iniciar sesión con tu cuenta.</Text>
            <View style={styles.confirmBtns}>
              <TouchableOpacity style={styles.confirmCancel} onPress={() => setShowLogoutConfirm(false)}>
                <Text style={styles.confirmCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmDanger, loggingOut && { opacity:0.6 }]}
                onPress={handleLogout}
                disabled={loggingOut}
              >
                {loggingOut ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmDangerText}>Cerrar sesión</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header:  { paddingHorizontal:20, paddingTop: Platform.OS === 'android' ? 44 : 12, paddingBottom:12,
             borderBottomWidth:1, borderBottomColor:'#F3F4F6' },
  title:   { fontSize:20, fontWeight:'800', color:'#111827' },
  scroll:  { padding:16 },
  sectionLabel: { fontSize:11, fontWeight:'700', color:'#9CA3AF', letterSpacing:1,
                  textTransform:'uppercase', marginBottom:8, marginTop:16, marginLeft:4 },
  group:   { backgroundColor:'#fff', borderRadius:16, overflow:'hidden',
             shadowColor:'#000', shadowOpacity:0.04, shadowRadius:6, elevation:1 },
  row:     { flexDirection:'row', alignItems:'center', padding:16, gap:12 },
  rowIcon: { fontSize:22, width:28, textAlign:'center' },
  rowBody: { flex:1, minWidth:0 },
  rowTitle:{ fontSize:15, fontWeight:'600', color:'#111827' },
  rowSub:  { fontSize:12, color:'#9CA3AF', marginTop:1 },
  rowChevron:{ fontSize:22, color:'#D1D5DB' },
  sep:     { height:1, backgroundColor:'#F3F4F6', marginLeft:56 },

  profileCard:       { backgroundColor:'#fff', borderRadius:16, padding:16, marginBottom:4,
                       flexDirection:'row', alignItems:'center', gap:14,
                       shadowColor:'#000', shadowOpacity:0.04, shadowRadius:6, elevation:1 },
  profileAvatar:     { width:52, height:52, borderRadius:26, backgroundColor:'#3B82F6',
                       justifyContent:'center', alignItems:'center', flexShrink:0 },
  profileAvatarText: { color:'#fff', fontSize:22, fontWeight:'700' },
  profileName:       { fontSize:17, fontWeight:'700', color:'#111827' },
  profileEmail:      { fontSize:13, color:'#9CA3AF', marginTop:2 },
  editNameBtn:       { paddingHorizontal:10, paddingVertical:6, backgroundColor:'#F3F4F6', borderRadius:8 },
  editNameText:      { fontSize:12, color:'#6B7280', fontWeight:'500' },

  modalBackdrop: { flex:1, backgroundColor:'rgba(0,0,0,0.45)', justifyContent:'flex-end', alignItems:'center' },
  modalSheet:    { backgroundColor:'#fff', borderTopLeftRadius:24, borderTopRightRadius:24,
                   width:'100%', maxWidth:600, maxHeight:'80%' },
  modalHead:     { flexDirection:'row', justifyContent:'space-between', alignItems:'center',
                   paddingHorizontal:20, paddingVertical:16, borderBottomWidth:1, borderBottomColor:'#F3F4F6' },
  modalTitle:    { fontSize:16, fontWeight:'700', color:'#111827' },
  modalClose:    { fontSize:14, color:'#3B82F6', fontWeight:'500' },
  monedaOpt:     { flexDirection:'row', alignItems:'center', paddingHorizontal:20, paddingVertical:14, gap:14 },
  monedaFlag:    { fontSize:24 },
  monedaCode:    { fontSize:15, fontWeight:'600', color:'#111827' },
  monedaLabel:   { fontSize:12, color:'#9CA3AF' },

  formBody:  { padding:20, paddingBottom:36 },
  mLabel:    { fontSize:13, fontWeight:'500', color:'#374151', marginBottom:8 },
  mInput:    { height:50, backgroundColor:'#F9FAFB', borderWidth:1, borderColor:'#E5E7EB',
               borderRadius:12, paddingHorizontal:14, fontSize:15, color:'#111827' },
  saveBtn:   { height:50, backgroundColor:'#3B82F6', borderRadius:12,
               justifyContent:'center', alignItems:'center', marginTop:16 },
  saveBtnText:{ color:'#fff', fontSize:15, fontWeight:'600' },

  confirmBackdrop:  { flex:1, backgroundColor:'rgba(0,0,0,0.5)', justifyContent:'center', alignItems:'center', padding:20 },
  confirmBox:       { backgroundColor:'#fff', borderRadius:20, padding:24, width:'100%', maxWidth:340 },
  confirmTitle:     { fontSize:17, fontWeight:'700', color:'#111827', marginBottom:8 },
  confirmSub:       { fontSize:14, color:'#6B7280', lineHeight:20, marginBottom:20 },
  confirmBtns:      { flexDirection:'row', gap:10 },
  confirmCancel:    { flex:1, height:46, backgroundColor:'#F3F4F6', borderRadius:12, justifyContent:'center', alignItems:'center' },
  confirmCancelText:{ fontSize:15, color:'#374151', fontWeight:'500' },
  confirmDanger:    { flex:1, height:46, backgroundColor:'#DC2626', borderRadius:12, justifyContent:'center', alignItems:'center' },
  confirmDangerText:{ fontSize:15, color:'#fff', fontWeight:'600' },
});
