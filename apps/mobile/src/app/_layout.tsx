import { Barlow_400Regular, Barlow_500Medium, Barlow_700Bold } from '@expo-google-fonts/barlow';
import {
  BigShouldersDisplay_700Bold,
  BigShouldersDisplay_800ExtraBold,
} from '@expo-google-fonts/big-shoulders-display';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useGame } from '@/game/store';
import { colors } from '@/theme/tokens';

void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const hydrate = useGame((s) => s.hydrate);
  const [fontsLoaded, fontError] = useFonts({
    BigShouldersDisplay_700Bold,
    BigShouldersDisplay_800ExtraBold,
    Barlow_400Regular,
    Barlow_500Medium,
    Barlow_700Bold,
  });
  const ready = fontsLoaded || !!fontError;

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: 'fade',
        }}
      />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.bg } });
