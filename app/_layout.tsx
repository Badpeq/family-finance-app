import { useEffect, useState } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { Stack, router } from 'expo-router';
import { supabase } from '@/lib/supabase';

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'INITIAL_SESSION') {
          if (!session) {
            router.replace('/(auth)/login');
          } else {
            await navigateByProfile(session.user.id);
          }
          setReady(true);
        } else if (event === 'SIGNED_IN') {
          await navigateByProfile(session!.user.id);
        } else if (event === 'SIGNED_OUT') {
          router.replace('/(auth)/login');
        }
      }
    );
    return () => subscription.unsubscribe();
  }, []);

  return (
    <View style={styles.root}>
      <Stack screenOptions={{ headerShown: false }} />
      {!ready && (
        <View style={styles.splash}>
          <ActivityIndicator size="large" color="#3B82F6" />
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

  if (data?.perfil_completado === false) {
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
