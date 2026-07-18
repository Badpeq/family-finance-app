import { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, Modal, ScrollView, Platform, SafeAreaView, Alert,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useCategorias, ICON_MAP } from '@/hooks/useCategorias';
import { T, R, MAXW } from '@/theme';

// ── Types ──────────────────────────────────────────────────────────────────────

interface PendingTx {
  id:                 string;
  monto:              number;
  moneda:             string | null;
  descripcion:        string | null;
  fecha:              string | null;
  creado_en:          string;
  fuente:             string | null;
  fuente_raw:         string | null;
  metodo_pago:        string | null;
  tarjeta_id:         string | null;
  categoria_sugerida: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function normalizar(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '').replace(/\s+/g, ' ');
}

// ── Constants ──────────────────────────────────────────────────────────────────

const SYM: Record<string, string> = {
  PEN: 'S/', USD: '$', EUR: '€', BRL: 'R$', COP: '$', MXN: '$', ARS: '$', CLP: '$',
};

function fmt(monto: number, moneda: string | null) {
  const s = SYM[moneda ?? 'PEN'] ?? moneda ?? 'S/';
  return `${s} ${monto.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fuenteLabel(fuente: string | null) {
  if (!fuente) return '🤖 Auto';
  if (fuente.includes('email'))        return '📧 Email';
  if (fuente.includes('notification')) return '🔔 Notificación';
  if (fuente.includes('whatsapp'))     return '💬 WhatsApp';
  return '🤖 Auto';
}

function fmtDate(fecha: string | null, creado_en: string) {
  const src = fecha ?? creado_en;
  const d   = new Date(src);
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function Pendientes() {
  const [txs,     setTxs]     = useState<PendingTx[]>([]);
  const [loading, setLoading] = useState(true);

  // Categorize modal state
  const [selected,    setSelected]    = useState<PendingTx | null>(null);
  const [showCatModal, setShowCatModal] = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [showRaw,     setShowRaw]     = useState<string | null>(null);

  const { categorias } = useCategorias();

  useFocusEffect(
    useCallback(() => {
      load();
    }, []),
  );

  async function load() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data } = await supabase
      .from('transacciones')
      .select('id,monto,moneda,descripcion,fecha,creado_en,fuente,fuente_raw,metodo_pago,tarjeta_id,categoria_sugerida')
      .eq('user_id', user.id)
      .eq('estado', 'PENDIENTE_REVISION')
      .eq('activo', true)
      .order('creado_en', { ascending: false });

    setTxs(data ?? []);
    setLoading(false);
  }

  async function confirmar(tx: PendingTx, categoria: string) {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    await supabase
      .from('transacciones')
      .update({ estado: 'PROCESADO', categoria })
      .eq('id', tx.id);

    // Aprender la regla para este comercio
    if (user && tx.descripcion) {
      const comercioNorm = normalizar(tx.descripcion);
      supabase.from('reglas_categorizacion').upsert(
        { user_id: user.id, comercio_normalizado: comercioNorm, categoria },
        { onConflict: 'user_id,comercio_normalizado' },
      ).then(() => {});
    }

    setSaving(false);
    setShowCatModal(false);
    setSelected(null);
    load();
  }

  async function confirmarTodo() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setSaving(true);
    const conSugerida = txs.filter(t => t.categoria_sugerida);
    await Promise.all(conSugerida.map(async tx => {
      const cat = tx.categoria_sugerida!;
      await supabase.from('transacciones').update({ estado: 'PROCESADO', categoria: cat }).eq('id', tx.id);
      if (tx.descripcion) {
        const comercioNorm = normalizar(tx.descripcion);
        await supabase.from('reglas_categorizacion').upsert(
          { user_id: user.id, comercio_normalizado: comercioNorm, categoria: cat },
          { onConflict: 'user_id,comercio_normalizado' },
        );
      }
    }));
    setSaving(false);
    load();
  }

  async function rechazar(tx: PendingTx) {
    Alert.alert(
      'Rechazar gasto',
      '¿Eliminar este gasto capturado automáticamente?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar', style: 'destructive',
          onPress: async () => {
            await supabase
              .from('transacciones')
              .update({ activo: false })
              .eq('id', tx.id);
            load();
          },
        },
      ],
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#7C3AED" />
      </View>
    );
  }

  return (
    <View style={s.root}>
      {/* Header */}
      <SafeAreaView style={s.headerWrap}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Text style={s.backIcon}>‹</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Pendientes de revisión</Text>
            <Text style={s.subtitle}>
              {txs.length === 0 ? 'Todo al día' : `${txs.length} gasto${txs.length > 1 ? 's' : ''} por revisar`}
            </Text>
          </View>
          {txs.some(t => t.categoria_sugerida) && (
            <TouchableOpacity style={s.confirmAllBtn} onPress={confirmarTodo} disabled={saving}>
              <Text style={s.confirmAllText}>✓ Confirmar todo</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>

      {txs.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyIcon}>✅</Text>
          <Text style={s.emptyTitle}>Sin pendientes</Text>
          <Text style={s.emptyBody}>
            Cuando lleguen gastos automáticos por email o notificación aparecerán aquí.
          </Text>
        </View>
      ) : (
        <FlatList
          data={txs}
          keyExtractor={t => t.id}
          contentContainerStyle={[s.list, s.constrain]}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          renderItem={({ item: tx }) => (
            <View style={s.card}>
              {/* Top row */}
              <View style={s.cardTop}>
                <View style={s.cardLeft}>
                  <Text style={s.comercio} numberOfLines={1}>
                    {tx.descripcion ?? 'Sin nombre'}
                  </Text>
                  <Text style={s.cardMeta}>
                    {fuenteLabel(tx.fuente)}  ·  {fmtDate(tx.fecha, tx.creado_en)}
                  </Text>
                  {tx.categoria_sugerida && (
                    <View style={s.sugChip}>
                      <Text style={s.sugChipText}>✨ {tx.categoria_sugerida}</Text>
                    </View>
                  )}
                </View>
                <Text style={s.monto}>{fmt(tx.monto, tx.moneda)}</Text>
              </View>

              {/* Raw text button */}
              {tx.fuente_raw && (
                <TouchableOpacity
                  style={s.rawBtn}
                  onPress={() => setShowRaw(tx.fuente_raw)}
                >
                  <Text style={s.rawBtnText}>Ver texto original</Text>
                </TouchableOpacity>
              )}

              {/* Actions */}
              <View style={s.actions}>
                <TouchableOpacity
                  style={s.btnReject}
                  onPress={() => rechazar(tx)}
                >
                  <Text style={s.btnRejectText}>✕ Rechazar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.btnConfirm}
                  onPress={() => {
                    if (tx.categoria_sugerida) {
                      confirmar(tx, tx.categoria_sugerida);
                    } else {
                      setSelected(tx);
                      setShowCatModal(true);
                    }
                  }}
                >
                  <Text style={s.btnConfirmText}>✓ Confirmar</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}

      {/* Raw text modal */}
      <Modal visible={!!showRaw} transparent animationType="fade" onRequestClose={() => setShowRaw(null)}>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setShowRaw(null)}>
          <View style={s.rawModal}>
            <Text style={s.rawModalTitle}>Texto original</Text>
            <ScrollView style={s.rawScroll}>
              <Text style={s.rawText}>{showRaw}</Text>
            </ScrollView>
            <TouchableOpacity style={s.rawClose} onPress={() => setShowRaw(null)}>
              <Text style={s.rawCloseText}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Category picker modal */}
      <Modal
        visible={showCatModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCatModal(false)}
      >
        <View style={s.overlay}>
          <View style={s.catModal}>
            <Text style={s.catModalTitle}>Categorizar gasto</Text>
            {selected && (
              <Text style={s.catModalSub}>
                {selected.descripcion ?? 'Sin nombre'} · {fmt(selected.monto, selected.moneda)}
              </Text>
            )}

            <ScrollView style={s.catList} showsVerticalScrollIndicator={false}>
              {categorias.filter(c => !['Sueldo','Bono','Freelance','Inversiones','Negocio',
                'Ahorro','Retiro Ahorro','Pago Tarjeta','Abono Préstamo'].includes(c.nombre))
                .map(cat => (
                  <TouchableOpacity
                    key={cat.nombre}
                    style={s.catRow}
                    disabled={saving}
                    onPress={() => selected && confirmar(selected, cat.nombre)}
                  >
                    <Text style={s.catIcon}>{ICON_MAP[cat.nombre] ?? cat.icono ?? '📦'}</Text>
                    <Text style={s.catName}>{cat.nombre}</Text>
                    {saving && <ActivityIndicator size="small" color="#7C3AED" />}
                  </TouchableOpacity>
                ))
              }
            </ScrollView>

            <TouchableOpacity style={s.catCancel} onPress={() => setShowCatModal(false)}>
              <Text style={s.catCancelText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:       { flex: 1, backgroundColor: T.screen },
  center:     { flex: 1, justifyContent: 'center', alignItems: 'center' },
  constrain:  { width: '100%', maxWidth: MAXW, alignSelf: 'center' },

  headerWrap: { backgroundColor: T.card, borderBottomWidth: 1, borderBottomColor: T.border },
  header:     {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingTop: Platform.OS === 'android' ? 44 : 12,
    paddingHorizontal: 16, paddingBottom: 14,
  },
  backBtn:    { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  backIcon:   { fontSize: 28, color: T.textSec, lineHeight: 32 },
  title:      { fontSize: 18, fontWeight: '800', color: T.textPrimary },
  subtitle:   { fontSize: 12, color: T.textSec, marginTop: 1 },

  list:       { padding: 16 },

  card:       {
    backgroundColor: T.card, borderRadius: R.card,
    padding: 16, borderWidth: 1, borderColor: T.border,
  },
  cardTop:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardLeft:   { flex: 1, marginRight: 12 },
  comercio:   { fontSize: 15, fontWeight: '700', color: T.textPrimary },
  cardMeta:   { fontSize: 12, color: T.textMicro, marginTop: 3 },
  monto:      { fontSize: 17, fontWeight: '800', color: T.red },

  confirmAllBtn:  { backgroundColor: T.accentSoft, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  confirmAllText: { fontSize: 12, fontWeight: '700', color: T.accentDark },

  sugChip:     { marginTop: 5, alignSelf: 'flex-start', backgroundColor: T.accentSoft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  sugChipText: { fontSize: 11, fontWeight: '600', color: T.accentDark },

  rawBtn:     { marginTop: 10, alignSelf: 'flex-start' },
  rawBtnText: { fontSize: 12, color: T.accent, fontWeight: '600' },

  actions:    { flexDirection: 'row', gap: 10, marginTop: 14 },
  btnReject:  {
    flex: 1, paddingVertical: 10, borderRadius: R.control,
    backgroundColor: T.redSoft, alignItems: 'center',
  },
  btnRejectText: { fontSize: 13, fontWeight: '700', color: T.red },
  btnConfirm: {
    flex: 2, paddingVertical: 10, borderRadius: R.control,
    backgroundColor: T.accent, alignItems: 'center',
  },
  btnConfirmText: { fontSize: 13, fontWeight: '700', color: '#fff' },

  empty:      { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyIcon:  { fontSize: 52, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: T.textPrimary, marginBottom: 8 },
  emptyBody:  { fontSize: 14, color: T.textSec, textAlign: 'center', lineHeight: 22 },

  overlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },

  rawModal:      { backgroundColor: T.card, borderRadius: R.card, padding: 20, maxHeight: '70%' },
  rawModalTitle: { fontSize: 15, fontWeight: '700', color: T.textPrimary, marginBottom: 12 },
  rawScroll:     { maxHeight: 300 },
  rawText:       { fontSize: 13, color: T.textSec, lineHeight: 20 },
  rawClose:      { marginTop: 16, alignItems: 'center', paddingVertical: 12,
                   backgroundColor: T.screen, borderRadius: R.control },
  rawCloseText:  { fontSize: 14, fontWeight: '600', color: T.textSec },

  catModal:      {
    backgroundColor: T.card, borderRadius: 20,
    padding: 20, maxHeight: '80%', alignSelf: 'stretch',
  },
  catModalTitle: { fontSize: 17, fontWeight: '800', color: T.textPrimary, marginBottom: 4 },
  catModalSub:   { fontSize: 13, color: T.textSec, marginBottom: 16 },
  catList:       { maxHeight: 380 },
  catRow:        {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: T.border,
  },
  catIcon:       { fontSize: 22 },
  catName:       { flex: 1, fontSize: 15, fontWeight: '600', color: T.textPrimary },
  catCancel:     { marginTop: 16, alignItems: 'center', paddingVertical: 13,
                   backgroundColor: T.screen, borderRadius: R.control },
  catCancelText: { fontSize: 14, fontWeight: '600', color: T.textSec },
});
