import { Tabs } from 'expo-router';
import { Platform, View } from 'react-native';

// Dot indicator — no emojis, renders perfectly on all platforms/manufacturers
function Dot({ focused }: { focused: boolean }) {
  return (
    <View style={{ width: 32, height: 6, alignItems: 'center', justifyContent: 'center' }}>
      {focused && (
        <View style={{ width: 20, height: 3, borderRadius: 2, backgroundColor: '#3B82F6' }} />
      )}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopColor: '#F3F4F6',
          borderTopWidth: 1,
          height: Platform.OS === 'ios' ? 82 : 60,
          paddingBottom: Platform.OS === 'ios' ? 22 : 8,
          paddingTop: 6,
          elevation: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.05,
          shadowRadius: 6,
        },
        tabBarActiveTintColor:   '#3B82F6',
        tabBarInactiveTintColor: '#9CA3AF',
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          includeFontPadding: false,
          marginTop: 0,
        },
        tabBarItemStyle: { paddingHorizontal: 2 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Inicio',     tabBarIcon: ({ focused }) => <Dot focused={focused} /> }}
      />
      <Tabs.Screen
        name="transacciones"
        options={{ title: 'Movimientos', tabBarIcon: ({ focused }) => <Dot focused={focused} /> }}
      />
      <Tabs.Screen
        name="analisis"
        options={{ title: 'Análisis',   tabBarIcon: ({ focused }) => <Dot focused={focused} /> }}
      />
      <Tabs.Screen
        name="cuentas"
        options={{ title: 'Cuentas',    tabBarIcon: ({ focused }) => <Dot focused={focused} /> }}
      />
      <Tabs.Screen
        name="mas"
        options={{ title: 'Config',     tabBarIcon: ({ focused }) => <Dot focused={focused} /> }}
      />
    </Tabs>
  );
}
