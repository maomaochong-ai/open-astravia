import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, RotateCcw } from "lucide-react-native";
import { useEffect, useMemo, useRef } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { AssistantTurn, MarkerRow, QuestionCard, UserBubble } from "../../components/chat";
import { Composer } from "../../components/composer";
import { Header, Screen } from "../../components/ui";
import { t } from "../../i18n/strings";
import { formatClock } from "../../remote/relative-time";
import { emptyTranscript, isActiveStatus, type TranscriptItem } from "../../remote/transcript";
import { useAppStore } from "../../store/app-store";

type Row = { key: string; item: TranscriptItem } | { key: string; question: true } | { key: string; timestamp: number };

export default function SessionScreen() {
	const { id } = useLocalSearchParams<{ id: string }>();
	const sessionId = typeof id === "string" ? id : "";
	const router = useRouter();
	const transcript = useAppStore((state) => state.transcripts[sessionId] ?? emptyTranscript);
	const session = useAppStore((state) => state.sessions.find((entry) => entry.id === sessionId));
	const desktop = useAppStore((state) => state.desktop);
	const link = useAppStore((state) => state.link);
	const preferences = useAppStore((state) => state.preferences);
	const openSession = useAppStore((state) => state.openSession);
	const sendPrompt = useAppStore((state) => state.sendPrompt);
	const respond = useAppStore((state) => state.respond);
	const abort = useAppStore((state) => state.abort);
	const resync = useAppStore((state) => state.resync);
	const listRef = useRef<FlatList<Row>>(null);
	const online = link.status === "online" && link.peerOnline;
	const active = isActiveStatus(transcript.sessionState.status);

	useEffect(() => {
		if (sessionId) void openSession(sessionId);
	}, [sessionId, openSession]);

	const rows = useMemo<Row[]>(() => {
		const out: Row[] = [];
		const first = transcript.items[0];
		if (first?.at) out.push({ key: "ts", timestamp: first.at });
		for (const item of transcript.items) out.push({ key: item.id, item });
		if (transcript.pendingQuestion) out.push({ key: `q-${transcript.pendingQuestion.requestId}`, question: true });
		return out;
	}, [transcript.items, transcript.pendingQuestion]);

	useEffect(() => {
		if (rows.length > 0) listRef.current?.scrollToEnd({ animated: true });
	}, [rows.length]);

	const subtitle = [desktop?.desktopName, transcript.sessionState.model].filter(Boolean).join(" · ");
	const statusLine = active ? t.chat.summaryRunning : t.chat.summaryDone;

	return (
		<Screen>
			<Header
				title={t.chat.assistant}
				subtitle={subtitle || undefined}
				online={online}
				left={{ icon: ChevronLeft, label: t.common.back, onPress: () => router.back() }}
				right={{ icon: RotateCcw, label: t.chat.resync, onPress: () => void resync(sessionId) }}
			/>
			<KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
				<FlatList
					ref={listRef}
					data={rows}
					keyExtractor={(row) => row.key}
					contentContainerClassName="px-5 pt-2 pb-4"
					keyboardShouldPersistTaps="handled"
					onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
					renderItem={({ item: row, index }) => {
						if ("timestamp" in row) return <MarkerRow text={formatClock(row.timestamp)} />;
						if ("question" in row && transcript.pendingQuestion) {
							const request = transcript.pendingQuestion;
							return (
								<QuestionCard
									request={request}
									onSubmit={(answers) => void respond(sessionId, request.requestId, answers)}
									onSkip={() => void respond(sessionId, request.requestId, [], true)}
								/>
							);
						}
						if (!("item" in row)) return null;
						const item = row.item;
						if (item.kind === "user") return <UserBubble text={item.text} />;
						if (item.kind === "marker") return <MarkerRow text={item.text || t.chat.compacted} />;
						const lastAssistant = index === rows.length - 1 || (index === rows.length - 2 && "question" in (rows[rows.length - 1] ?? {}));
						return <AssistantTurn item={item} showThinking={preferences.liveThinking || !item.streaming} statusLine={lastAssistant ? statusLine : undefined} />;
					}}
					ListEmptyComponent={
						<View className="items-center py-16">
							<Text className="text-[13px] text-dim">{transcript.loaded ? (session?.title ?? "") : t.chat.loadingHistory}</Text>
						</View>
					}
				/>
				<Composer
					placeholder={t.chat.composerPlaceholder}
					disabled={!online}
					busy={active}
					onStop={() => void abort(sessionId)}
					onSend={(text) => void sendPrompt(sessionId, text)}
				/>
			</KeyboardAvoidingView>
		</Screen>
	);
}
