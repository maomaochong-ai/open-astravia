import "../../global.css";

import * as Haptics from "expo-haptics";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { HeroUINativeProvider } from "heroui-native";
import { useEffect } from "react";
import { Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Uniwind } from "uniwind";
import { installCryptoPolyfill } from "../remote/platform/crypto-polyfill";
import { describeDevice, loadDeviceId } from "../remote/platform/device";
import { SqliteSessionCache } from "../remote/platform/sqlite-cache";
import { SecureKeyValueStore, SettingsKeyValueStore } from "../remote/platform/stores";
import { createNativeTransport } from "../remote/platform/websocket";
import { type AppPlatform, useAppStore } from "../store/app-store";
import { useTheme } from "../theme/use-theme";

installCryptoPolyfill();
SplashScreen.preventAutoHideAsync().catch(() => undefined);

function buildPlatform(): AppPlatform {
	const web = Platform.OS === "web";
	return {
		settings: new SettingsKeyValueStore(),
		secrets: new SecureKeyValueStore(),
		cache: new SqliteSessionCache(),
		createTransport: createNativeTransport,
		deviceName: describeDevice(),
		loadDeviceId: (store) => loadDeviceId(store, () => Math.random().toString(36).slice(2, 12)),
		onTurnEnd: () => {
			if (!web) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
		},
		applyTheme: (theme) => Uniwind.setTheme(theme),
	};
}

export default function RootLayout() {
	const ready = useAppStore((state) => state.ready);
	const paired = useAppStore((state) => state.paired);
	const init = useAppStore((state) => state.init);
	const router = useRouter();
	const segments = useSegments();
	const { colors, isDark } = useTheme();

	useEffect(() => {
		void init(buildPlatform());
	}, [init]);

	useEffect(() => {
		if (!ready) return;
		SplashScreen.hideAsync().catch(() => undefined);
		const onPair = segments[0] === "pair";
		if (!paired && !onPair) router.replace("/pair");
	}, [ready, paired, segments, router]);

	return (
		<GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.page }}>
			<HeroUINativeProvider config={{ textProps: { maxFontSizeMultiplier: 1.4 } }}>
				<View style={{ flex: 1, backgroundColor: colors.page }}>
					<StatusBar style={isDark ? "light" : "dark"} />
					<Stack
						screenOptions={{
							headerShown: false,
							contentStyle: { backgroundColor: colors.page },
							animation: "slide_from_right",
						}}
					>
						<Stack.Screen name="index" />
						<Stack.Screen name="session/[id]" />
						<Stack.Screen name="settings" />
						<Stack.Screen name="pair" options={{ animation: "slide_from_bottom", gestureEnabled: paired }} />
					</Stack>
				</View>
			</HeroUINativeProvider>
		</GestureHandlerRootView>
	);
}
