import { CameraView, useCameraPermissions } from "expo-camera";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { BottomSheet } from "heroui-native";
import { ChevronRight, Keyboard as KeyboardIcon, WifiOff, X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScanFrame } from "../components/scan-frame";
import { Header, Screen, StatusDot } from "../components/ui";
import { t } from "../i18n/strings";
import type { PairingFailure } from "../remote/pairing-flow";
import { useAppStore } from "../store/app-store";
import { palette } from "../theme/colors";
import { useTheme } from "../theme/use-theme";

function describeFailure(reason: PairingFailure): string {
	switch (reason) {
		case "invalid_code":
			return t.pair.invalidCode;
		case "rejected":
			return t.pair.rejected;
		case "unauthorized":
			return t.pair.unauthorized;
		case "invalid_endpoint":
			return t.pair.manualInvalid;
		default:
			return t.pair.failed;
	}
}

export default function PairScreen() {
	const router = useRouter();
	const { colors } = useTheme();
	const insets = useSafeAreaInsets();
	const paired = useAppStore((state) => state.paired);
	const pairing = useAppStore((state) => state.pairing);
	const pairWithCode = useAppStore((state) => state.pairWithCode);
	const pairManually = useAppStore((state) => state.pairManually);
	const cancelPairing = useAppStore((state) => state.cancelPairing);
	const refreshLink = useAppStore((state) => state.refreshLink);
	const [permission, requestPermission] = useCameraPermissions();
	const [manualOpen, setManualOpen] = useState(false);
	const [helpOpen, setHelpOpen] = useState(false);
	const [endpoint, setEndpoint] = useState("");
	const busyRef = useRef(false);
	const web = Platform.OS === "web";

	const finish = useCallback(() => {
		refreshLink();
		if (router.canGoBack()) router.back();
		else router.replace("/");
	}, [router, refreshLink]);

	const handleCode = useCallback(
		async (data: string) => {
			if (busyRef.current) return;
			busyRef.current = true;
			const ok = await pairWithCode(data);
			busyRef.current = false;
			if (ok) finish();
		},
		[pairWithCode, finish],
	);

	useEffect(() => {
		const sub = Linking.addEventListener("url", ({ url }) => {
			if (url.startsWith("vetta://pair")) void handleCode(url);
		});
		void Linking.getInitialURL().then((url) => {
			if (url?.startsWith("vetta://pair")) void handleCode(url);
		});
		return () => sub.remove();
	}, [handleCode]);

	useEffect(() => {
		if (!web && permission && !permission.granted && permission.canAskAgain) void requestPermission();
	}, [permission, requestPermission, web]);

	const scanning = pairing.kind === "idle" && !manualOpen && !helpOpen;
	const busy = pairing.kind === "connecting";

	const submitManual = async () => {
		if (busyRef.current) return;
		busyRef.current = true;
		const ok = await pairManually(endpoint);
		busyRef.current = false;
		if (ok) {
			setManualOpen(false);
			finish();
		}
	};

	return (
		<Screen>
			<Header
				title={t.pair.title}
				left={paired ? { icon: X, label: t.common.close, onPress: () => void cancelPairing().then(() => router.back()) } : undefined}
				right={{ icon: WifiOff, label: t.pair.troubleshootTitle, onPress: () => setHelpOpen(true), tint: colors.dim }}
			/>
			<View className="flex-1 items-center px-6">
				<View className="mt-8">
					<ScanFrame active={scanning && permission?.granted === true}>
						{!web && permission?.granted ? (
							<CameraView
								style={{ flex: 1 }}
								facing="back"
								barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
								onBarcodeScanned={scanning ? ({ data }) => void handleCode(data) : undefined}
							/>
						) : (
							<View className="flex-1 items-center justify-center px-6">
								{!web && permission && !permission.granted ? (
									<>
										<Text className="text-center text-[13px] text-dim">{t.pair.cameraDenied}</Text>
										<Pressable accessibilityRole="button" onPress={() => void requestPermission()} className="mt-3 rounded-full bg-card-2 px-4 py-2">
											<Text className="text-[13px] text-ink">{t.pair.grantCamera}</Text>
										</Pressable>
									</>
								) : null}
							</View>
						)}
					</ScanFrame>
				</View>

				{pairing.kind === "awaiting_approval" ? (
					<View className="mt-8 items-center">
						<Text className="text-[13px] text-dim">{t.pair.verificationCode}</Text>
						<Text className="mt-2 font-mono text-[40px] font-bold tracking-[8px] text-ink">{pairing.verificationCode}</Text>
						<Text className="mt-3 text-center text-[14px] text-ink-2">{t.pair.waitingApproval}</Text>
						<Text className="mt-1 text-center text-[12px] text-dim">{t.pair.codeHint}</Text>
					</View>
				) : (
					<>
						<Text className="mt-8 text-[20px] font-semibold text-ink">{t.pair.scanHint}</Text>
						<Text className="mt-2 px-4 text-center text-[13px] leading-5 text-dim">{t.pair.scanDescription}</Text>
					</>
				)}

				<View className="mt-5 flex-row items-center gap-2 rounded-full bg-card px-3.5 py-2">
					{busy ? <ActivityIndicator size="small" color={palette.green} /> : <StatusDot color={palette.green} size={6} />}
					<Text className="text-[12px] text-ink-2">{busy ? t.pair.connecting : t.pair.listening}</Text>
				</View>

				{pairing.kind === "failed" ? <Text className="mt-4 text-center text-[13px] text-vetta-red">{describeFailure(pairing.reason)}</Text> : null}
			</View>

			<View className="px-6" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
				<Pressable
					accessibilityRole="button"
					onPress={() => setManualOpen(true)}
					className="flex-row items-center justify-center gap-2 rounded-full bg-pill py-4 active:opacity-85"
				>
					<KeyboardIcon size={18} color={colors.pillInk} strokeWidth={1.9} />
					<Text className="text-[15px] font-semibold text-pill-ink">{t.pair.manual}</Text>
				</Pressable>
				<Pressable accessibilityRole="button" onPress={() => setHelpOpen(true)} className="mt-4 flex-row items-center justify-center gap-1">
					<Text className="text-[13px] text-dim">{t.pair.troubleshoot}</Text>
					<ChevronRight size={14} color={colors.dim} />
				</Pressable>
			</View>

			<BottomSheet
				isOpen={manualOpen}
				onOpenChange={(open) => {
					setManualOpen(open);
					if (!open) void cancelPairing();
				}}
			>
				<BottomSheet.Portal>
					<BottomSheet.Overlay />
					<BottomSheet.Content detached bottomInset={insets.bottom + 12} className="mx-4" backgroundClassName="rounded-[28px] bg-card">
						<View className="px-5 pb-6 pt-2">
							<BottomSheet.Title className="text-[18px] font-semibold text-ink">{t.pair.manualTitle}</BottomSheet.Title>
							<BottomSheet.Description className="mt-1 text-[13px] text-dim">{t.pair.manualHint}</BottomSheet.Description>
							{pairing.kind === "awaiting_approval" ? (
								<View className="mt-5 items-center">
									<Text className="text-[13px] text-dim">{t.pair.verificationCode}</Text>
									<Text className="mt-2 font-mono text-[40px] font-bold tracking-[8px] text-ink">{pairing.verificationCode}</Text>
									<Text className="mt-3 text-center text-[14px] text-ink-2">{t.pair.waitingApproval}</Text>
									<Text className="mt-1 text-center text-[12px] text-dim">{t.pair.codeHint}</Text>
								</View>
							) : (
								<>
									<TextInput
										className="mt-4 rounded-2xl bg-card-2 px-4 py-3.5 font-mono text-[16px] text-ink"
										placeholder={t.pair.manualPlaceholder}
										placeholderTextColor={colors.faint}
										value={endpoint}
										onChangeText={setEndpoint}
										autoCapitalize="none"
										autoCorrect={false}
										keyboardType="url"
										returnKeyType="go"
										onSubmitEditing={() => void submitManual()}
										accessibilityLabel={t.pair.manualPlaceholder}
									/>
									{pairing.kind === "failed" ? <Text className="mt-2 text-[12px] text-vetta-red">{describeFailure(pairing.reason)}</Text> : null}
									<Pressable
										accessibilityRole="button"
										disabled={busy}
										onPress={() => void submitManual()}
										className={`mt-4 items-center rounded-full py-3.5 ${busy ? "bg-card-2" : "bg-pill"}`}
									>
										{busy ? <ActivityIndicator color={colors.dim} /> : <Text className="text-[15px] font-semibold text-pill-ink">{t.pair.connect}</Text>}
									</Pressable>
								</>
							)}
						</View>
					</BottomSheet.Content>
				</BottomSheet.Portal>
			</BottomSheet>

			<BottomSheet isOpen={helpOpen} onOpenChange={setHelpOpen}>
				<BottomSheet.Portal>
					<BottomSheet.Overlay />
					<BottomSheet.Content detached bottomInset={insets.bottom + 12} className="mx-4" backgroundClassName="rounded-[28px] bg-card">
						<ScrollView className="px-5 pb-6 pt-2">
							<BottomSheet.Title className="text-[18px] font-semibold text-ink">{t.pair.troubleshootTitle}</BottomSheet.Title>
							<View className="mt-3 gap-3">
								{t.pair.troubleshootItems.map((item, index) => (
									<View key={item} className="flex-row gap-3">
										<Text className="font-mono text-[13px] text-vetta-green">{index + 1}</Text>
										<Text className="flex-1 text-[14px] leading-[21px] text-ink-2">{item}</Text>
									</View>
								))}
							</View>
						</ScrollView>
					</BottomSheet.Content>
				</BottomSheet.Portal>
			</BottomSheet>
		</Screen>
	);
}
