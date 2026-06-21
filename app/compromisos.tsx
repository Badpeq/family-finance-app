import { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, SafeAreaView, Platform,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';

const SYM: Record<string, string> = { PEN: 'S/', USD: '$', EUR: '€', BRL: 'R$', COP: '$', MXN: '$', ARS: '$', CLP: '$' };

interface CompromisoProgramado {
  id: string;
  tipo_programado: 'recurrente' | 'cuota';
  descripcion: string | null;
  categoria: string;
  monto_cuota: number;
  dia_cobro: number;
  aplicado: boolean;
}

interface Cuota {
  id: string;
  total_cuotas: number;
  mes_inicio: string;
  descripcion: string;
}

function cuotaActual(mesInicioStr: string): number {
  const now = new Date();
  const ini = new Date(mesInicioStr + 'T12:00:00');
  return (now.getFullYear() - ini.getFullYear()) * 12 + now.getMonth() - ini.getMonth() + 1;
}

const CAT_ICONS: Record<string, string> = {
  Alimentación: '🛒', Transporte: '🚗', Vivienda: '🏠', Entretenimiento: '🎬',
  Salud: '💊', Educación: '📚', Ropa: '👕', Servicios: '⚡', Restaurantes: '🍽️', Otros: '📦',
};
const iconFor = (cat: string) => CAT_ICONS[cat] ?? '📦';

export default function Compromisos() {
  const [items,    setItems]    = useState<CompromisoProgramado[]>([]);
  const [cuotas,   setCuotas]   = useState<Cuota[]>([]);
  const [currency, setCurrency] = useState('PEN');
  const [loading,  setLoading]  = useState(true);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !active) return;

        const [profRes, viewRes, cuotasRes] = await Promise.all([
          supabase.from('profiles').select('moneda_base').eq('id', user.id).single(),
          supabase.from('v_gastos_programados_mes').select('id,tipo_programado,descripcion,categoria,monto_cuota,dia_cobro,aplicado').order('aplicado').order('dia_cobro'),
          supabase.from('compras_cuotas').select('id,total_cuotas,mes_inicio,descripcion').eq('user_id', user.id),
        ]);

        if (!active) return;
        if (profRes.data) setCurrency((profRes.data as any).moneda_base ?? 'PEN');
        setItems((viewRes.data ?? []) as CompromisoProgramado[]);
        setCuotas((cuotasRes.data ?? []) as Cuota[]);
        setLoading(false);
      })();
      return () => { active = false; };
    }, [])
  );

  const sym = SYM[currency] ?? currency;

  const pendientes = items.filter(i => !i.aplicado);
  const aplicados  = items.filter(i => i.aplicado);
  const totalPendiente = pendientes.reduce((s, i) => s + Number(i.monto_cuota), 0);
  const totalAplicado  = aplicados.reduce((s, i) => s + Number(i.monto_cuota), 0);

  const cuotaInfo = (id: string) => cuotas.find(c => c.id === id);

  const renderItem = (item: CompromisoProgramado) => {
    const cuota = item.tipo_programado === 'cuota' ? cuotaInfo(item.id) : null;
    const cuotaNum = cuota ? cuotaActual(cuota.mes_inicio) : null;
    return (
      <View key={item.id} style={s.card}>
        <View style={s.cardLeft}>
          <Text style={s.cardIcon}>{iconFor(item.categoria)}</Text>
        </View>
        <View style={s.cardBody}>
          <View style={s.cardTitleRow}>
            <Text style={s.cardName} numberOfLines={1}>
              {item.descripcion ?? item.categoria}
            </Text>
            <View style={[s.badge, item.tipo_programado === 'cuota' ? s.badgeCuota : s.badgeRec]}>
              <Text style={[s.badgeText, item.tipo_programado === 'cuota' ? s.badgeCuotaText : s.badgeRecText]}>
                {item.tipo_programado === 'cuota' ? '📅 Cuota' : '🔄 Recurrente'}
              </Text>
            </View>
          </View>
          <Text style={s.cardMeta}>
            {item.categoria}
            {cuota && cuotaNum !== null
              ? ` · Cuota ${cuotaNum} de ${cuota.total_cuotas}`
              : ` · Día ${item.dia_cobro} de cada mes`}
          </Text>
          {cuota && cuotaNum !== null && (
            <View style={s.progressBg}>
              <View style={[s.progressFill, { width: `${Math.min((cuotaNum / cuota.total_cuotas) * 100, 100)}%` as any }]} />
            </View>
          )}
        </View>
        <Text style={[s.cardAmt, item.aplicado ? s.amtApplied : s.amtPending]}>
          {sym} {Number(item.monto_cuota).toFixed(2)}
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>‹ Volver</Text>
        </TouchableOpacity>
        <Text style={s.title}>Compromisos Fijos</Text>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <ActivityIndicator color="#7C3AED" style={{ marginTop: 48 }} />
      ) : (
        <ScrollView contentContainerStyle={s.scroll}>

          {/* Resumen */}
          <View style={s.summary}>
            <View style={s.summaryItem}>
              <Text style={s.summaryLabel}>Pendientes</Text>
              <Text style={[s.summaryAmt, { color: '#DC2626' }]}>{sym} {totalPendiente.toFixed(2)}</Text>
              <Text style={s.summaryCount}>{pendientes.length} compromiso{pendientes.length !== 1 ? 's' : ''}</Text>
            </View>
            <View style={s.summaryDiv} />
            <View style={s.summaryItem}>
              <Text style={s.summaryLabel}>Aplicados</Text>
              <Text style={[s.summaryAmt, { color: '#059669' }]}>{sym} {totalAplicado.toFixed(2)}</Text>
              <Text style={s.summaryCount}>{aplicados.length} compromiso{aplicados.length !== 1 ? 's' : ''}</Text>
            </View>
          </View>

          {items.length === 0 && (
            <View style={s.empty}>
              <Text style={s.emptyIcon}>🔄</Text>
              <Text style={s.emptyTitle}>Sin compromisos fijos este mes</Text>
              <Text style={s.emptySub}>
                Registra gastos recurrentes o cuotas desde la pantalla de Registrar o al importar un voucher.
              </Text>
            </View>
          )}

          {pendientes.length > 0 && (
            <>
              <Text style={s.sectionLabel}>PENDIENTES — {sym} {totalPendiente.toFixed(2)}</Text>
              {pendientes.map(renderItem)}
            </>
          )}

          {aplicados.length > 0 && (
            <>
              <Text style={[s.sectionLabel, { marginTop: 20 }]}>APLICADOS ESTE MES ✓</Text>
              {aplicados.map(renderItem)}
            </>
          )}

          <View style={{ height: 48 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#F9FAFB' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'android' ? 44 : 12, paddingHorizontal: 20, paddingBottom: 14,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  backBtn:  { width: 60 },
  backText: { fontSize: 16, color: '#3B82F6', fontWeight: '500' },
  title:    { fontSize: 18, fontWeight: '700', color: '#111827' },

  scroll: { padding: 16 },

  summary:     { backgroundColor: '#fff', borderRadius: 16, padding: 20, flexDirection: 'row', marginBottom: 20, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryLabel:{ fontSize: 11, color: '#9CA3AF', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  summaryAmt:  { fontSize: 20, fontWeight: '800', marginBottom: 2 },
  summaryCount:{ fontSize: 11, color: '#9CA3AF' },
  summaryDiv:  { width: 1, backgroundColor: '#F3F4F6', marginHorizontal: 10 },

  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 },

  card:      { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  cardLeft:  { width: 40, height: 40, borderRadius: 10, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center', marginRight: 12, flexShrink: 0 },
  cardIcon:  { fontSize: 20 },
  cardBody:  { flex: 1, minWidth: 0 },
  cardTitleRow:{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' },
  cardName:  { fontSize: 14, fontWeight: '600', color: '#111827', flexShrink: 1 },
  cardMeta:  { fontSize: 11, color: '#9CA3AF', marginBottom: 4 },
  cardAmt:   { fontSize: 15, fontWeight: '700', marginLeft: 10, flexShrink: 0 },
  amtPending:{ color: '#DC2626' },
  amtApplied:{ color: '#059669' },

  progressBg:   { height: 4, backgroundColor: '#F3F4F6', borderRadius: 2, overflow: 'hidden', marginTop: 2 },
  progressFill: { height: '100%' as any, backgroundColor: '#7C3AED', borderRadius: 2 },

  badge:         { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeRec:      { backgroundColor: '#D1FAE5' },
  badgeRecText:  { color: '#065F46' },
  badgeCuota:    { backgroundColor: '#DBEAFE' },
  badgeCuotaText:{ color: '#1E40AF' },
  badgeText:     { fontSize: 10, fontWeight: '700' },

  empty:      { alignItems: 'center', paddingTop: 48, paddingHorizontal: 32 },
  emptyIcon:  { fontSize: 48, marginBottom: 14 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#374151', marginBottom: 8, textAlign: 'center' },
  emptySub:   { fontSize: 13, color: '#9CA3AF', textAlign: 'center', lineHeight: 20 },
});
