import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

// Cancela y reprograma el recordatorio diario de registro de gastos (hora fija: 21:00)
export async function scheduleDailyReminder() {
  if (Platform.OS === 'web') return;
  await Notifications.cancelAllScheduledNotificationsAsync();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: '💰 ¿Registraste tus gastos hoy?',
      body: 'Tarda menos de 1 minuto. ¡Mantén tu control financiero al día!',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: 21,
      minute: 0,
    },
  });
}

// Notificación inmediata cuando un presupuesto diario está por agotarse
export async function notifyBudgetWarning(categoria: string, pctUsed: number) {
  if (Platform.OS === 'web') return;
  const label = pctUsed >= 1 ? 'agotado' : `${Math.round(pctUsed * 100)}% usado`;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `⚠️ Presupuesto de ${categoria} al límite`,
      body: `Tu cuota diaria de ${categoria} está ${label}. Revisa tus gastos de hoy.`,
    },
    trigger: null, // inmediata
  });
}

export function useNotifications() {
  useEffect(() => {
    requestNotificationPermission();
  }, []);
}
