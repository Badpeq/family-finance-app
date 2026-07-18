import { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Modal, TextInput, SafeAreaView, Platform,
  Switch, Alert, Clipboard,
} from 'react-native';
import { router } from 'expo-router';
import { useHogar } from '@/hooks/useHogar';
import { supabase } from '@/lib/supabase';
import { T, R, MAXW } from '@/theme';

const MODULO_LABELS: Record<string, { label: string; icon: string }> = {
  transacciones: { label: 'Transacciones', icon: '💸' },
  presupuestos:  { label: 'Presupuestos',  icon: '📊' },
  tarjetas:      { label: 'Tarjetas',      icon: '💳' },
  prestamos:     { label: 'Préstamos',     icon: '📋' },
  ahorros:       { label: 'Ahorros',       icon: '🏦' },
  recurrentes:   { label: 'Recurrentes',   icon: '🔄' },
  cuotas:        { label: 'Cuotas',        icon: '🛍️' },
};

export default function Hogar() {
  const {
    loading, hogar, membresia, miembros, modulos, esAdmin,
    crearHogar, solicitarUnion, aprobar, remover, liberarModulo,
  } = useHogar();
  const [myUserId, setMyUserId] = useState('');

  // Crear hogar modal
  // Cargar userId propio al montar
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setMyUserId(user.id);
    });
  }, []);

  const [showCrear,     setShowCrear]     = useState(false);
  const [nombreHogar,   setNombreHogar]   = useState('');
  const [savingCrear,   setSavingCrear]   = useState(false);
  const [errorCrear,    setErrorCrear]    = useState('');

  // Unirse modal
  const [showUnirse,    setShowUnirse]    = useState(false);
  const [codigoInput,   setCodigoInput]   = useState('');
  const [savingUnirse,  setSavingUnirse]  = useState(false);
  const [errorUnirse,   setErrorUnirse]   = useState('');

  // Confirmar remover
  const [removiendo,    setRemoviendo]    = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; nombre: string } | null>(null);

  const handleCrearHogar = async () => {
    if (!nombreHogar.trim()) { setErrorCrear('Escribe un nombre para el hogar.'); return; }
    setSavingCrear(true); setErrorCrear('');
    try {
      await crearHogar(nombreHogar.trim());
      setShowCrear(false);
      setNombreHogar('');
    } catch (e) {
      setErrorCrear(e instanceof Error ? e.message : 'Error al crear el hogar.');
    }
    setSavingCrear(false);
  };

  const handleUnirse = async () => {
    if (!codigoInput.trim()) { setErrorUnirse('Ingresa el código de invitación.'); return; }
    setSavingUnirse(true); setErrorUnirse('');
    try {
      await solicitarUnion(codigoInput.trim());
      setShowUnirse(false);
      setCodigoInput('');
    } catch (e) {
      setErrorUnirse(e instanceof Error ? e.message : 'Error al unirse al hogar.');
    }
    setSavingUnirse(false);
  };

  const handleAprobar = async (userId: string) => {
    try {
      await aprobar(userId);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'No se pudo aprobar.');
    }
  };

  const handleRemover = async () => {
    if (!confirmRemove) return;
    setRemoviendo(confirmRemove.id);
    try {
      await remover(confirmRemove.id);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'No se pudo remover.');
    }
    setRemoviendo(null);
    setConfirmRemove(null);
  };

  const copiarCodigo = () => {
    if (!hogar) return;
    Clipboard.setString(hogar.codigo_invitacion);
    Alert.alert('Copiado', `Código ${hogar.codigo_invitacion} copiado al portapapeles.`);
  };

  const handleToggleModulo = async (modulo: string, habilitado: boolean) => {
    try {
      await liberarModulo(modulo, habilitado);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'No se pudo cambiar el módulo.');
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: T.screen }}>
        <ActivityIndicator color={T.accent} />
      </View>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>‹ Volver</Text>
        </TouchableOpacity>
        <Text style={s.title}>Mi Hogar</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll}>

        {/* ── Sin hogar: opciones crear/unirse ── */}
        {!hogar && (
          <View style={{ gap: 12 }}>
            <Text style={s.intro}>
              Comparte tus finanzas con tu familia. El administrador controla qué módulos son visibles para los demás.
            </Text>

            <TouchableOpacity style={s.optCard} onPress={() => { setNombreHogar(''); setErrorCrear(''); setShowCrear(true); }}>
              <Text style={s.optIcon}>🏠</Text>
              <View style={s.optBody}>
                <Text style={s.optTitle}>Crear hogar</Text>
                <Text style={s.optSub}>Sé el administrador e invita a tu familia</Text>
              </View>
              <Text style={s.chevron}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.optCard} onPress={() => { setCodigoInput(''); setErrorUnirse(''); setShowUnirse(true); }}>
              <Text style={s.optIcon}>🔗</Text>
              <View style={s.optBody}>
                <Text style={s.optTitle}>Unirse a un hogar</Text>
                <Text style={s.optSub}>Ingresa el código que te compartió el administrador</Text>
              </View>
              <Text style={s.chevron}>›</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Miembro pendiente ── */}
        {hogar && membresia?.estado === 'pendiente' && (
          <View style={s.pendCard}>
            <Text style={s.pendIcon}>⏳</Text>
            <Text style={s.pendTitle}>Esperando aprobación</Text>
            <Text style={s.pendSub}>
              Tu solicitud para unirte a «{hogar.nombre}» está pendiente de aprobación por el administrador.
            </Text>
          </View>
        )}

        {/* ── Miembro activo ── */}
        {hogar && membresia?.estado === 'activo' && (
          <>
            {/* Info del hogar */}
            <View style={s.card}>
              <View style={s.hogarHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={s.hogarNombre}>{hogar.nombre}</Text>
                  <Text style={s.hogarSub}>
                    {miembros.filter(m => m.estado === 'activo').length} miembro(s) activo(s)
                  </Text>
                </View>
                {esAdmin && (
                  <TouchableOpacity style={s.codigoBtn} onPress={copiarCodigo}>
                    <Text style={s.codigoCodigo}>{hogar.codigo_invitacion}</Text>
                    <Text style={s.codigoLabel}>Copiar</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Miembros */}
            <SLabel>MIEMBROS</SLabel>
            <View style={s.card}>
              {miembros.length === 0 && (
                <Text style={s.emptyText}>Sin miembros registrados.</Text>
              )}
              {miembros.map((m, i) => (
                <View key={m.id}>
                  {i > 0 && <View style={s.sep} />}
                  <View style={s.memberRow}>
                    <View style={s.memberAvatar}>
                      <Text style={s.memberAvatarText}>{m.nombre?.charAt(0).toUpperCase() ?? '?'}</Text>
                    </View>
                    <View style={s.memberBody}>
                      <Text style={s.memberName}>{m.nombre}</Text>
                      <Text style={s.memberRole}>
                        {m.rol === 'admin' ? 'Administrador' : 'Miembro'}
                        {m.estado === 'pendiente' ? ' · Pendiente' : ''}
                      </Text>
                    </View>
                    {esAdmin && m.estado === 'pendiente' && (
                      <TouchableOpacity style={s.approveBtn} onPress={() => handleAprobar(m.id)}>
                        <Text style={s.approveBtnText}>Aprobar</Text>
                      </TouchableOpacity>
                    )}
                    {esAdmin && m.estado === 'activo' && m.rol !== 'admin' && (
                      <TouchableOpacity
                        style={s.removeBtn}
                        onPress={() => setConfirmRemove({ id: m.id, nombre: m.nombre })}
                        disabled={removiendo === m.id}
                      >
                        {removiendo === m.id
                          ? <ActivityIndicator size="small" color={T.red} />
                          : <Text style={s.removeBtnText}>Remover</Text>}
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ))}
            </View>

            {/* Módulos liberados (solo admin) */}
            {esAdmin && modulos.length > 0 && (
              <>
                <SLabel>MÓDULOS COMPARTIDOS</SLabel>
                <Text style={s.modulosHint}>
                  Activa los módulos que quieres compartir con tu hogar. Los datos solo son visibles para miembros activos.
                </Text>
                <View style={s.card}>
                  {modulos.map((mod, i) => {
                    const info = MODULO_LABELS[mod.modulo] ?? { label: mod.modulo, icon: '📦' };
                    return (
                      <View key={mod.modulo}>
                        {i > 0 && <View style={s.sep} />}
                        <View style={s.moduloRow}>
                          <Text style={s.moduloIcon}>{info.icon}</Text>
                          <View style={s.moduloBody}>
                            <Text style={s.moduloLabel}>{info.label}</Text>
                            <Text style={s.moduloSub}>
                              {mod.habilitado ? 'Visible para el hogar' : 'Privado (solo tú)'}
                            </Text>
                          </View>
                          <Switch
                            value={mod.habilitado}
                            onValueChange={(val) => handleToggleModulo(mod.modulo, val)}
                            trackColor={{ false: T.inputBorder, true: T.accentSoft }}
                            thumbColor={mod.habilitado ? T.accent : T.textMicro}
                          />
                        </View>
                      </View>
                    );
                  })}
                </View>
              </>
            )}

            {/* Salir del hogar (miembro no-admin) */}
            {!esAdmin && (
              <>
                <SLabel>ACCIONES</SLabel>
                <View style={s.card}>
                  <TouchableOpacity
                    style={s.memberRow}
                    onPress={() => setConfirmRemove({ id: myUserId, nombre: 'tú mismo' })}
                  >
                    <Text style={[s.memberName, { color: T.red, flex: 1 }]}>Salir del hogar</Text>
                    <Text style={s.chevron}>›</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </>
        )}

        <View style={{ height: 48 }} />
      </ScrollView>

      {/* ── Crear hogar ── */}
      <Modal visible={showCrear} animationType="slide" transparent>
        <View style={s.modalBg}>
          <View style={s.modalSheet}>
            <View style={s.modalHead}>
              <Text style={s.modalTitle}>Crear hogar</Text>
              <TouchableOpacity onPress={() => setShowCrear(false)}>
                <Text style={s.modalClose}>Cancelar</Text>
              </TouchableOpacity>
            </View>
            <View style={s.modalBody}>
              <Text style={s.lbl}>Nombre del hogar</Text>
              <TextInput
                style={s.inp}
                placeholder="Ej: Familia García"
                placeholderTextColor={T.textMicro}
                value={nombreHogar}
                onChangeText={setNombreHogar}
                autoFocus
                maxLength={60}
              />
              {!!errorCrear && <Text style={s.err}>{errorCrear}</Text>}
              <TouchableOpacity
                style={[s.saveBtn, savingCrear && { opacity: 0.6 }]}
                onPress={handleCrearHogar}
                disabled={savingCrear}
              >
                {savingCrear
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.saveBtnText}>Crear hogar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Unirse ── */}
      <Modal visible={showUnirse} animationType="slide" transparent>
        <View style={s.modalBg}>
          <View style={s.modalSheet}>
            <View style={s.modalHead}>
              <Text style={s.modalTitle}>Unirse a un hogar</Text>
              <TouchableOpacity onPress={() => setShowUnirse(false)}>
                <Text style={s.modalClose}>Cancelar</Text>
              </TouchableOpacity>
            </View>
            <View style={s.modalBody}>
              <Text style={s.lbl}>Código de invitación</Text>
              <TextInput
                style={[s.inp, { textTransform: 'uppercase', letterSpacing: 3 }]}
                placeholder="XXXXXXXX"
                placeholderTextColor={T.textMicro}
                value={codigoInput}
                onChangeText={t => setCodigoInput(t.toUpperCase())}
                autoFocus
                autoCapitalize="characters"
                maxLength={8}
              />
              {!!errorUnirse && <Text style={s.err}>{errorUnirse}</Text>}
              <TouchableOpacity
                style={[s.saveBtn, savingUnirse && { opacity: 0.6 }]}
                onPress={handleUnirse}
                disabled={savingUnirse}
              >
                {savingUnirse
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.saveBtnText}>Solicitar unión</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Confirmar remover ── */}
      <Modal visible={!!confirmRemove} animationType="fade" transparent>
        <View style={s.confirmBg}>
          <View style={s.confirmBox}>
            <Text style={s.confirmTitle}>¿Remover miembro?</Text>
            <Text style={s.confirmSub}>
              {confirmRemove?.nombre} saldrá del hogar y sus datos volverán a ser privados.
            </Text>
            <View style={s.confirmBtns}>
              <TouchableOpacity style={s.confirmCancel} onPress={() => setConfirmRemove(null)}>
                <Text style={s.confirmCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.confirmDanger, removiendo ? { opacity: 0.6 } : {}]}
                onPress={handleRemover}
                disabled={!!removiendo}
              >
                {removiendo
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.confirmDangerText}>Remover</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function SLabel({ children }: { children: string }) {
  return <Text style={s.sectionLabel}>{children}</Text>;
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: T.screen },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'android' ? 44 : 12,
    paddingHorizontal: 20, paddingBottom: 14,
    backgroundColor: T.card, borderBottomWidth: 1, borderBottomColor: T.border,
  },
  backBtn:  { width: 60 },
  backText: { fontSize: 16, color: T.accent, fontWeight: '500' },
  title:    { fontSize: 18, fontWeight: '700', color: T.textPrimary },

  scroll: { padding: 16, width: '100%', maxWidth: MAXW, alignSelf: 'center' },

  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: T.textMicro,
    letterSpacing: 1, textTransform: 'uppercase',
    marginTop: 20, marginBottom: 6, marginLeft: 4,
  },

  intro: { fontSize: 14, color: T.textSec, lineHeight: 20, marginBottom: 8 },

  optCard: {
    backgroundColor: T.card, borderRadius: R.card, borderWidth: 1, borderColor: T.border,
    flexDirection: 'row', alignItems: 'center', padding: 18, gap: 14,
  },
  optIcon: { fontSize: 28 },
  optBody: { flex: 1 },
  optTitle:{ fontSize: 16, fontWeight: '700', color: T.textPrimary },
  optSub:  { fontSize: 13, color: T.textMicro, marginTop: 2 },
  chevron: { fontSize: 22, color: T.inputBorder },

  pendCard: {
    backgroundColor: T.amberSoft, borderRadius: R.card, padding: 24,
    alignItems: 'center', gap: 8,
  },
  pendIcon:  { fontSize: 36 },
  pendTitle: { fontSize: 17, fontWeight: '700', color: T.amber, textAlign: 'center' },
  pendSub:   { fontSize: 14, color: T.amber, textAlign: 'center', lineHeight: 20 },

  card: {
    backgroundColor: T.card, borderRadius: R.card, borderWidth: 1, borderColor: T.border,
    overflow: 'hidden',
  },
  sep: { height: 1, backgroundColor: T.border, marginLeft: 56 },

  hogarHeader: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  hogarNombre: { fontSize: 17, fontWeight: '700', color: T.textPrimary },
  hogarSub:    { fontSize: 12, color: T.textMicro, marginTop: 2 },

  codigoBtn:    { alignItems: 'center', backgroundColor: T.accentSoft, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  codigoCodigo: { fontSize: 15, fontWeight: '800', color: T.accent, letterSpacing: 2 },
  codigoLabel:  { fontSize: 10, color: T.accent, marginTop: 2 },

  memberRow:    { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  memberAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: T.accentSoft, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  memberAvatarText: { fontSize: 16, fontWeight: '700', color: T.accent },
  memberBody:   { flex: 1 },
  memberName:   { fontSize: 15, fontWeight: '600', color: T.textPrimary },
  memberRole:   { fontSize: 12, color: T.textMicro, marginTop: 2 },
  approveBtn:   { backgroundColor: T.accentSoft, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  approveBtnText: { fontSize: 13, fontWeight: '600', color: T.accent },
  removeBtn:    { paddingHorizontal: 10, paddingVertical: 6 },
  removeBtnText:{ fontSize: 13, color: T.red, fontWeight: '500' },

  moduloRow:   { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  moduloIcon:  { fontSize: 22, width: 28, textAlign: 'center' },
  moduloBody:  { flex: 1 },
  moduloLabel: { fontSize: 15, fontWeight: '600', color: T.textPrimary },
  moduloSub:   { fontSize: 12, color: T.textMicro, marginTop: 1 },
  modulosHint: { fontSize: 12, color: T.textMicro, marginBottom: 8, marginLeft: 4, lineHeight: 17 },

  emptyText: { fontSize: 13, color: T.textMicro, padding: 16, fontStyle: 'italic' },

  modalBg:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: T.card, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  modalHead:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: T.border },
  modalTitle: { fontSize: 16, fontWeight: '700', color: T.textPrimary },
  modalClose: { fontSize: 14, color: T.accent, fontWeight: '500' },
  modalBody:  { padding: 20, paddingBottom: 40 },

  lbl: { fontSize: 13, fontWeight: '500', color: T.textSec, marginBottom: 8 },
  inp: {
    height: 50, backgroundColor: T.input, borderWidth: 1, borderColor: T.inputBorder,
    borderRadius: R.control, paddingHorizontal: 14, fontSize: 15,
    color: T.textPrimary, marginBottom: 4,
  },
  err:     { color: T.red, fontSize: 13, marginTop: 6 },
  saveBtn: { height: 50, backgroundColor: T.accent, borderRadius: R.control, justifyContent: 'center', alignItems: 'center', marginTop: 16 },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },

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
