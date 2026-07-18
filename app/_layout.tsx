import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, AppStateStatus, Platform, View, StyleSheet } from 'react-native';
import { Stack, router } from 'expo-router';
import * as Sentry from '@sentry/react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '@/lib/supabase';
import { useAutoApplyCommitments } from '@/hooks/useAutoApplyCommitments';
import { useNotifications } from '@/hooks/useNotifications';

if (process.env.EXPO_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn:                        process.env.EXPO_PUBLIC_SENTRY_DSN,
    enableNativeFramesTracking: Platform.OS !== 'web',
    tracesSampleRate:           0.2,
  });
}

const BIOMETRIC_KEY = 'biometric_lock';

async function shouldPromptBiometric(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const enabled = await SecureStore.getItemAsync(BIOMETRIC_KEY);
  if (enabled === 'false') return false;
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  return enrolled;
}

export default function RootLayout() {
  const [ready,   setReady]   = useState(false);
  const [locked,  setLocked]  = useState(false);
  const appState  = useRef<AppStateStatus>(AppState.currentState);
  const authedRef = useRef(false);

  useAutoApplyCommitments();
  useNotifications();

  useEffect(() => {
    const sub = AppState.addEventListener('change', async (next) => {
      if (appState.current.match(/inactive|background/) && next === 'active' && authedRef.current) {
        if (await shouldPromptBiometric()) {
          setLocked(true);
          const result = await LocalAuthentication.authenticateAsync({
            promptMessage:    'Desbloquea Family Finance',
            cancelLabel:      'Salir',
            fallbackLabel:    'Usar contraseña',
            disableDeviceFallback: false,
          });
          if (result.success) {
            setLocked(false);
          } else {
            // Si cancela: cerrar sesión (más seguro que quedarse bloqueado)
            await supabase.auth.signOut();
            setLocked(false);
          }
        }
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'INITIAL_SESSION') {
          if (!session) {
            authedRef.current = false;
            router.replace('/(auth)/login');
          } else {
            authedRef.current = true;
            await navigateByProfile(session.user.id);
          }
          setReady(true);
        } else if (event === 'SIGNED_IN') {
          authedRef.current = true;
          await navigateByProfile(session!.user.id);
        } else if (event === 'SIGNED_OUT') {
          authedRef.current = false;
          router.replace('/(auth)/login');
        }
      }
    );
    return () => subscription.unsubscribe();
  }, []);

  return (
    <View style={styles.root}>
      <Stack screenOptions={{ headerShown: false }} />
      {(!ready || locked) && (
        <View style={styles.splash}>
          <ActivityIndicator size="large" color="#7C3AED" />
        </View>
      )}
    </View>
  );
}

async function navigateByProfile(userId: string) {
  const { data } = await supabase
    .from('profiles')
    .select('perfil_completado')
    .eq('id', userId)
    .single();

  if (!data || data.perfil_completado === false) {
    router.replace('/onboarding');
  } else {
    router.replace('/(tabs)');
  }
}

const styles = StyleSheet.create({
  root:   { flex: 1 },
  splash: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
});
