// ── src/theme.ts ────────────────────────────────────────────────────────────
// Tokens de diseño compartidos. Fuente de verdad: el Dashboard ("Home Evervault").
// Toda pantalla nueva debe importar de aquí en lugar de hardcodear colores.

export const T = {
  // Superficies
  screen:      '#F7F8FA',            // fondo de pantalla (igual al Dashboard)
  card:        '#FFFFFF',
  border:      'rgba(0,0,0,0.06)',   // hairline de cards (igual al Dashboard)
  input:       '#F9FAFB',
  inputBorder: '#E5E7EB',

  // Texto
  textPrimary: '#0D1117',
  textSec:     '#6B7280',
  textMicro:   '#9CA3AF',

  // Acento único de la app (violeta; el azul queda descontinuado en UI)
  accent:      '#7C3AED',
  accentSoft:  '#EDE9FE',
  accentDark:  '#5B21B6',

  // Semánticos (texto sobre fondo claro)
  green:       '#059669',
  greenSoft:   '#D1FAE5',
  red:         '#DC2626',
  redSoft:     '#FEF2F2',
  amber:       '#B45309',
  amberSoft:   '#FEF9C3',
} as const;

// Radios estándar
export const R = { card: 18, control: 12, chip: 20 } as const;

// Ancho máximo del contenido en pantallas anchas (web/tablet).
// Sin esto, las listas se estiran a todo el navegador y se ven deformes.
export const MAXW = 640;
