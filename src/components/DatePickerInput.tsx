import { useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { T } from '@/theme';

interface Props {
  value: string;           // YYYY-MM-DD  (empty = sin selección)
  onChange: (iso: string) => void;
  inputStyle?: object;
  placeholder?: string;
}

function fmtDisplay(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function toDate(iso: string): Date {
  return iso ? new Date(iso + 'T12:00:00') : new Date();
}

// ── Web: <input type="date"> del navegador ───────────────────────
function DatePickerWeb({ value, onChange, inputStyle, placeholder }: Props) {
  return (
    <View style={styles.wrap}>
      {/* @ts-ignore — input HTML solo existe en web */}
      <input
        type="date"
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        style={{
          height: 48,
          width: '100%',
          backgroundColor: T.input,
          border: `1px solid ${T.inputBorder}`,
          borderRadius: 10,
          paddingLeft: 14,
          paddingRight: 14,
          fontSize: 15,
          color: value ? T.textPrimary : T.textMicro,
          boxSizing: 'border-box',
          outline: 'none',
          fontFamily: 'inherit',
          cursor: 'pointer',
          ...(inputStyle as object),
        } as React.CSSProperties}
      />
    </View>
  );
}

// ── Native: spinner nativo vía @react-native-community/datetimepicker ──
function DatePickerNative({ value, onChange, inputStyle, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const DateTimePicker = require('@react-native-community/datetimepicker').default;

  function handleChange(_: unknown, selected?: Date) {
    setOpen(false);
    if (selected) onChange(selected.toISOString().slice(0, 10));
  }

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={[styles.btn, inputStyle as object]}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
      >
        <Text style={[styles.txt, !value && styles.placeholder]}>
          {value ? fmtDisplay(value) : (placeholder ?? 'Seleccionar fecha')}
        </Text>
        <Text style={styles.icon}>📅</Text>
      </TouchableOpacity>
      {open && (
        <DateTimePicker
          mode="date"
          value={toDate(value)}
          display="spinner"
          onChange={handleChange}
          maximumDate={new Date(2100, 11, 31)}
          minimumDate={new Date(2020, 0, 1)}
          locale="es-PE"
        />
      )}
    </View>
  );
}

export function DatePickerInput(props: Props) {
  if (Platform.OS === 'web') return <DatePickerWeb {...props} />;
  return <DatePickerNative {...props} />;
}

const styles = StyleSheet.create({
  wrap:        { width: '100%' },
  btn:         { height: 48, backgroundColor: T.input, borderWidth: 1, borderColor: T.inputBorder, borderRadius: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  txt:         { fontSize: 15, color: T.textPrimary },
  placeholder: { color: T.textMicro },
  icon:        { fontSize: 16 },
});
