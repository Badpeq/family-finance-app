# Arquitectura del Proyecto: Family Finance App

## 1. Stack Tecnológico
- **Frontend:** React Native / Expo Router (Soporte nativo para Web, iOS y Android con base de código única)
- **Lenguaje:** TypeScript (Configuración en modo estricto)
- **Estilos:** Tailwind CSS mediante NativeWind (o StyleSheet nativo si se prefiere)
- **Backend & Base de Datos:** Supabase (PostgreSQL)
- **Autenticación:** Supabase Auth (Exclusivo con Número de Celular + Contraseña)

## 2. Flujo de Autenticación y Onboarding
1. **Acceso:** El usuario ingresa únicamente con su número de teléfono (incluyendo código de país) y contraseña.
2. **Sincronización:** El registro en Supabase Auth dispara automáticamente un Trigger en PostgreSQL que inserta un registro espejo en la tabla pública `profiles` usando el mismo `id`.
3. **Onboarding:** Al iniciar sesión por primera vez, el flag `perfil_completado` estará en `false`, obligando a la app a redirigir al usuario a la pantalla de perfil para capturar su nombre, apellido y moneda base.

## 3. Estructura del Proyecto (Ecosistema Expo)
```text
family-finance-app/
├── app/                  # Rutas de Expo Router (Pantallas)
│   ├── (auth)/           # Grupo de autenticación (login, registro por celular)
│   ├── (tabs)/           # Flujo principal con pestañas inferiores (dashboard, presupuestos, ahorros)
│   ├── onboarding.tsx    # Pantalla obligatoria si perfil_completado == false
│   └── _layout.tsx       # Root layout y guardianes de ruta (protección de sesión)
├── src/
│   ├── components/       # Componentes UI reutilizables (tarjetas de gastos, botones, modales)
│   ├── hooks/            # Custom hooks para manejar estados financieros y supabase
│   └── lib/              # Inicialización de clientes (supabase.ts)
├── docs/
│   └── architecture.md   # Este archivo de especificaciones