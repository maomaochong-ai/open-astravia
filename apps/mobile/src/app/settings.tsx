import { useRouter } from "expo-router";
import { ChevronLeft, Moon, Sun } from "lucide-react-native";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { ActionRow, SectionTitle, ToggleRow } from "../components/settings-rows";
import { Divider, Header, Screen, Segmented, StatusDot } from "../components/ui";
import { t } from "../i18n/strings";
import { type ConfirmPolicy, type ThemePreference, useAppStore } from "../store/app-store";
import { palette } from "../theme/colors";
import { useTheme } from "../theme/use-theme";

export default function SettingsScreen() {
	const router = useRouter();
	const { colors } = useTheme();
	const desktop = useAppStore((state) => state.desktop);
	const link = useAppStore((state) => state.link);
	const preferences = useAppStore((state) => state.preferences);
	const setPreference = useAppStore((state) => state.setPreference);
	const unpair = useAppStore((state) => state.unpair);
	const online = link.status === "online" && link.peerOnline;
	const running = link.desktop?.runningSessionCount ?? 0;

	const connectionLabel = (() => {
		if (!online) return link.status === "connecting" ? t.common.connecting : t.settings.offline;
		const rtt = Math.round(link.rttMs ?? 0);
		if (!link.rttMs) return link.channel === "lan" ? t.settings.viaLan : t.settings.viaRelay;
		if (rtt < 60) return t.settings.excellent(rtt);
		if (rtt < 200) return t.settings.good(rtt);
		return t.settings.fair(rtt);
	})();

	const confirmUnpair = () => {
		Alert.alert(t.settings.unpair, t.settings.unpairConfirm, [
			{ text: t.common.cancel, style: "cancel" },
			{
				text: t.settings.unpair,
				style: "destructive",
				onPress: () => {
					void unpair().then(() => router.replace("/pair"));
				},
			},
		]);
	};

	return (
		<Screen>
			<Header title={t.settings.title} left={{ icon: ChevronLeft, label: t.common.back, onPress: () => router.back() }} />
			<ScrollView contentContainerClassName="px-5 pb-12" showsVerticalScrollIndicator={false}>
				<Text className="mt-2 text-[34px] font-bold leading-[42px] text-ink">{t.settings.heading}</Text>
				<Text className="mt-1.5 text-[14px] text-dim">{t.settings.subheading}</Text>

				<View className="mt-7 flex-row items-center justify-between">
					<View className="flex-1">
						<View className="flex-row items-center gap-2">
							<Text className="text-[17px] font-semibold text-ink">{t.settings.myComputer}</Text>
							<StatusDot color={online ? palette.green : colors.faint} />
						</View>
						<Text className="mt-1 text-[13px] text-dim">
							{desktop ? `${desktop.desktopName} · ${online ? t.common.online : t.common.offline}` : t.settings.noComputer}
						</Text>
					</View>
					<Pressable accessibilityRole="button" onPress={() => router.push("/pair")} className="rounded-full bg-card-2 px-4 py-2 active:opacity-70">
						<Text className="text-[13px] font-medium text-ink">{t.settings.rescan}</Text>
					</Pressable>
				</View>

				<View className="mt-5 flex-row">
					<View className="flex-1">
						<Text className="text-[12px] text-dim">{t.settings.connectionState}</Text>
						<Text className={`mt-1 text-[15px] font-semibold ${online ? "text-vetta-green" : "text-ink"}`}>{connectionLabel}</Text>
						{online && link.rttMs ? (
							<Text className="mt-0.5 text-[11px] text-faint">{link.channel === "lan" ? t.settings.viaLan : t.settings.viaRelay}</Text>
						) : null}
					</View>
					<View className="mx-4 w-px bg-line" />
					<View className="flex-1">
						<Text className="text-[12px] text-dim">{t.settings.load}</Text>
						<Text className="mt-1 text-[15px] font-semibold text-ink">{running > 0 ? t.settings.loadValue(running) : t.settings.loadIdle}</Text>
					</View>
				</View>

				<Divider className="my-6" />

				<SectionTitle title={t.settings.appearance} hint={t.settings.appearanceHint} />
				<Segmented<ThemePreference>
					stretch
					value={preferences.theme}
					onChange={(value) => void setPreference("theme", value)}
					options={[
						{ value: "dark", label: t.settings.dark, icon: Moon },
						{ value: "light", label: t.settings.light, icon: Sun },
					]}
				/>

				<Divider className="my-6" />

				<SectionTitle title={t.settings.confirmPolicy} hint={t.settings.confirmPolicyHint} />
				<Segmented<ConfirmPolicy>
					stretch
					value={preferences.confirmPolicy}
					onChange={(value) => void setPreference("confirmPolicy", value)}
					options={[
						{ value: "major", label: t.settings.policyMajor },
						{ value: "important", label: t.settings.policyImportant },
						{ value: "auto", label: t.settings.policyAuto },
					]}
				/>

				<Divider className="my-6" />

				<ToggleRow
					title={t.settings.liveThinking}
					hint={t.settings.liveThinkingHint}
					value={preferences.liveThinking}
					onChange={(value) => void setPreference("liveThinking", value)}
				/>
				<ToggleRow
					title={t.settings.haptics}
					hint={t.settings.hapticsHint}
					value={preferences.haptics}
					onChange={(value) => void setPreference("haptics", value)}
				/>
				<ToggleRow title={t.settings.biometric} hint={t.settings.biometricHint} value={false} onChange={() => undefined} disabled />

				<Divider className="my-4" />
				<ActionRow title={t.settings.unpair} hint={t.settings.unpairHint} onPress={confirmUnpair} destructive />
			</ScrollView>
		</Screen>
	);
}
