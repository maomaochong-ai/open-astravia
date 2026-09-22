import type { RemoteSessionSummary } from "@vetta/remote-control";
import { useRouter } from "expo-router";
import { Monitor, ScanLine, Search, SlidersHorizontal, TerminalSquare } from "lucide-react-native";
import { useMemo, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Text, TextInput, View } from "react-native";
import { Composer } from "../components/composer";
import { SessionCard } from "../components/session-card";
import { Banner, Card, Header, Screen, Segmented } from "../components/ui";
import { t } from "../i18n/strings";
import { isProcessing, useAppStore } from "../store/app-store";
import { palette } from "../theme/colors";
import { useTheme } from "../theme/use-theme";

type Filter = "all" | "processing" | "done";

export default function HomeScreen() {
	const router = useRouter();
	const { colors } = useTheme();
	const sessions = useAppStore((state) => state.sessions);
	const link = useAppStore((state) => state.link);
	const lastError = useAppStore((state) => state.lastError);
	const clearError = useAppStore((state) => state.clearError);
	const sendPrompt = useAppStore((state) => state.sendPrompt);
	const refreshSessions = useAppStore((state) => state.refreshSessions);
	const [filter, setFilter] = useState<Filter>("all");
	const [query, setQuery] = useState("");
	const online = link.status === "online" && link.peerOnline;

	const processing = useMemo(() => sessions.filter(isProcessing), [sessions]);
	const visible = useMemo(() => {
		const base = filter === "processing" ? processing : filter === "done" ? sessions.filter((s) => !isProcessing(s)) : sessions;
		const needle = query.trim().toLowerCase();
		const filtered = needle
			? base.filter((s) => s.title.toLowerCase().includes(needle) || (s.preview ?? "").toLowerCase().includes(needle))
			: base;
		return [...filtered].sort((a, b) => b.updatedAt - a.updatedAt);
	}, [sessions, processing, filter, query]);

	const openSession = (session: RemoteSessionSummary) => router.push({ pathname: "/session/[id]", params: { id: session.id } });

	const header = (
		<View className="px-5">
			<Text className="mt-2 text-[34px] font-bold leading-[42px] text-ink">{t.home.title}</Text>
			<Text className="mt-1.5 text-[14px] text-dim">{t.home.subtitle}</Text>

			<View className="mt-5 flex-row items-end">
				<View className="flex-row items-end">
					<Text className="text-[30px] font-bold leading-[34px] text-vetta-green">{processing.length}</Text>
					<Text className="mb-1 ml-1.5 text-[13px] text-dim">{t.home.processing}</Text>
				</View>
				<View className="mx-5 h-6 w-px bg-line" />
				<View className="flex-row items-end">
					<Text className="text-[30px] font-bold leading-[34px] text-ink">{sessions.length - processing.length}</Text>
					<Text className="mb-1 ml-1.5 text-[13px] text-dim">{t.home.done}</Text>
				</View>
			</View>

			<View className="mt-5 flex-row gap-3">
				<EntryCard icon={<Monitor size={18} color={palette.green} strokeWidth={1.9} />} title={t.home.remoteDesktop} hint={t.home.remoteDesktopHint} />
				<EntryCard icon={<TerminalSquare size={18} color={palette.green} strokeWidth={1.9} />} title={t.home.sshTerminal} hint={t.home.sshTerminalHint} />
			</View>

			<View className="mt-4 flex-row items-center rounded-full bg-card px-4 py-1">
				<Search size={16} color={colors.dim} strokeWidth={1.9} />
				<TextInput
					className="ml-2.5 flex-1 py-2.5 text-[14px] text-ink"
					placeholder={t.home.searchPlaceholder}
					placeholderTextColor={colors.dim}
					value={query}
					onChangeText={setQuery}
					accessibilityLabel={t.home.searchPlaceholder}
					returnKeyType="search"
				/>
			</View>

			<View className="mt-4">
				<Segmented<Filter>
					value={filter}
					onChange={setFilter}
					options={[
						{ value: "all", label: t.home.filterAll },
						{ value: "processing", label: t.home.filterProcessing(processing.length) },
						{ value: "done", label: t.home.filterDone },
					]}
				/>
			</View>
			{!online ? (
				<View className="mt-3">
					<Banner text={t.home.offlineBanner} />
				</View>
			) : null}
			{lastError ? (
				<Text className="mt-2 text-[12px] text-vetta-red" onPress={clearError}>
					{lastError}
				</Text>
			) : null}
		</View>
	);

	return (
		<Screen>
			<Header
				title="Vetta"
				online={online}
				left={{ icon: SlidersHorizontal, label: t.settings.title, onPress: () => router.push("/settings") }}
				right={{ icon: ScanLine, label: t.pair.title, onPress: () => router.push("/pair") }}
			/>
			<KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
				<FlatList
					data={visible}
					keyExtractor={(item) => item.id}
					ListHeaderComponent={header}
					contentContainerClassName="pb-4"
					renderItem={({ item, index }) => (
						<View className="px-5">
							<SessionCard session={item} onPress={() => openSession(item)} last={index === visible.length - 1} />
						</View>
					)}
					ListEmptyComponent={
						<View className="items-center px-5 py-14">
							<Text className="text-[13px] text-dim">{sessions.length === 0 ? t.home.empty : t.home.emptyFiltered}</Text>
						</View>
					}
					refreshing={false}
					onRefresh={() => void refreshSessions()}
					keyboardShouldPersistTaps="handled"
				/>
				<Composer
					leadingIcon
					placeholder={t.home.composerPlaceholder}
					disabled={!online}
					onSend={async (text) => {
						const id = await sendPrompt(undefined, text);
						if (id) router.push({ pathname: "/session/[id]", params: { id } });
					}}
				/>
			</KeyboardAvoidingView>
		</Screen>
	);
}

function EntryCard({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
	return (
		<Card className="flex-1 flex-row items-center px-4 py-3.5 opacity-60">
			<View className="h-10 w-10 items-center justify-center rounded-xl bg-card-2">{icon}</View>
			<View className="ml-3 flex-1">
				<View className="flex-row items-center gap-1.5">
					<Text className="text-[14px] font-semibold text-ink">{title}</Text>
				</View>
				<Text className="mt-0.5 text-[11px] text-dim">{t.common.comingSoon}</Text>
			</View>
		</Card>
	);
}
