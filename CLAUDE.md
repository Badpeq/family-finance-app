# Family Finance App

## Stack
- Expo SDK 56 + Expo Router (file-based, carpeta app/), TypeScript estricto, alias @/* → ./src/*
- Estilos: React Native StyleSheet inline tipado. NO usar Tailwind/NativeWind.
- Backend: Supabase (Postgres 15, RLS en todas las tablas), Edge Functions en Deno (supabase/functions/)
- La lógica de saldos vive en triggers de Postgres. El frontend SOLO hace INSERT
  en pagos_tarjeta / prestamos_abonos / ahorros_inversiones; nunca UPDATE de saldos.

## Flujo de base de datos (OBLIGATORIO)
- Cambios de esquema SOLO vía `supabase migration new <nombre>` + editar el SQL generado.
- NUNCA aplicar SQL directo a producción. Target por defecto: proyecto staging.
- Políticas RLS de escritura existentes (auth.uid() = user_id) NO se modifican.
- hogar_miembros: usar SIEMPRE las funciones fn_mi_hogar()/fn_es_admin_hogar()
  en políticas (evita recursión RLS). No escribir subqueries directas a hogar_miembros
  dentro de sus propias políticas.

## Convenciones
- Textos de UI en español (es-PE). Moneda base PEN, formateo S/ 1,234.56.
- Componentes reutilizables en src/components/, hooks en src/hooks/.
- Refetch con useFocusEffect, sin estado global ni Context API.
- DatePickerInput para toda fecha (cross-platform web/native).

## Comandos
- npx tsc --noEmit        # typecheck (debe pasar antes de cada commit)
- npx expo start          # dev
- npx expo export --platform web   # build web (no debe romperse)

## Documentos de referencia
- docs/architecture.md            # arquitectura V10 vigente
- docs/architecture-v11.md        # plan de seguridad e ingesta
- docs/hogar-implementacion.md    # este feature (Modo Hogar V12)
