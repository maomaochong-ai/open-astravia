import type { RemoteQuestionAnswer, RemoteQuestionRequest } from "@vetta/remote-control";
import { Brain, Check, ChevronDown, ChevronUp, Search, Settings2, TerminalSquare, Wrench } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { t } from "../i18n/strings";
import type { ToolCard as ToolCardModel, TranscriptItem } from "../remote/transcript";
import { palette } from "../theme/colors";
import { useTheme } from "../theme/use-theme";
import { Markdown } from "./markdown";
import { Divider, Pill } from "./ui";

export function UserBubble({ text }: { text: string }) {
	return (
		<View className="mb-4 items-end">
			<View className="max-w-[86%] rounded-[20px] rounded-br-md bg-bubble px-4 py-3">
				<Text className="text-[15px] leading-[22px] text-bubble-ink">{text}</Text>
			</View>
		</View>
	);
}

function ToolIcon({ toolName }: { toolName: string }) {
	const props = { size: 16, color: palette.green, strokeWidth: 1.9 } as const;
	const name = toolName.toLowerCase();
	if (name.includes("search") || name.includes("fetch") || name.includes("web")) return <Search {...props} />;
	if (name.includes("bash") || name.includes("shell") || name.includes("exec") || name.includes("terminal")) return <TerminalSquare {...props} />;
	if (name.includes("aggregate") || name.includes("data") || name.includes("compute")) return <Settings2 {...props} />;
	return <Wrench {...props} />;
}

function summarizeArgs(args: string | undefined): string {
	if (!args) return "";
	try {
		const parsed: unknown = JSON.parse(args);
		if (typeof parsed === "object" && parsed !== null) {
			const values = Object.values(parsed as Record<string, unknown>).filter(
				(value): value is string | number => typeof value === "string" || typeof value === "number",
			);
			if (values.length > 0) return String(values[0]).slice(0, 60);
		}
	} catch {
		// Raw text argument previews are fine as-is.
	}
	return args.slice(0, 60);
}

export function ToolCard({ tool }: { tool: ToolCardModel }) {
	const { colors } = useTheme();
	const [open, setOpen] = useState(false);
	const badge =
		tool.status === "done"
			? { label: tool.label ?? t.chat.toolDone, tone: "green" as const }
			: tool.status === "failed"
				? { label: t.chat.toolFailed, tone: "orange" as const }
				: tool.status === "generating"
					? { label: t.chat.toolGenerating, tone: "neutral" as const }
					: { label: tool.label ?? t.chat.toolRunning, tone: "neutral" as const };
	const summary = summarizeArgs(tool.args);
	const detail = tool.result ?? tool.args;
	return (
		<View className="mb-2 overflow-hidden rounded-2xl bg-card">
			<Pressable accessibilityRole="button" onPress={() => setOpen((value) => !value)} className="flex-row items-center px-3.5 py-3">
				<ToolIcon toolName={tool.toolName} />
				<Text className="ml-2.5 flex-1 font-mono text-[13px] text-ink" numberOfLines={1}>
					{tool.toolName}
					{summary ? <Text className="text-ink-2">: {summary}</Text> : null}
				</Text>
				<Pill tone={badge.tone}>{badge.label}</Pill>
				<View className="ml-1.5">
					{open ? <ChevronUp size={14} color={colors.dim} /> : <ChevronDown size={14} color={colors.dim} />}
				</View>
			</Pressable>
			{open && detail ? (
				<>
					<Divider />
					<View className="px-3.5 py-3">
						<Text className="font-mono text-[12px] leading-[18px] text-ink-2" numberOfLines={30}>
							{detail}
						</Text>
						{tool.durationMs !== undefined ? (
							<Text className="mt-2 font-mono text-[11px] text-faint">{Math.round(tool.durationMs)} ms</Text>
						) : null}
					</View>
				</>
			) : null}
		</View>
	);
}

export function ThinkingBlock({ text, live }: { text: string; live: boolean }) {
	const { colors } = useTheme();
	const [open, setOpen] = useState(false);
	if (!text.trim()) return null;
	return (
		<View className="mb-2">
			<Pressable accessibilityRole="button" onPress={() => setOpen((value) => !value)} className="flex-row items-center gap-1.5 py-1">
				<Brain size={14} color={colors.dim} strokeWidth={1.8} />
				<Text className="text-[12px] text-dim">{live ? t.chat.thinkingLive : t.chat.thinking}</Text>
				{open ? <ChevronUp size={13} color={colors.faint} /> : <ChevronDown size={13} color={colors.faint} />}
			</Pressable>
			{open || live ? (
				<Text className="mt-1 text-[13px] leading-5 text-faint" numberOfLines={open ? undefined : 4}>
					{text}
				</Text>
			) : null}
		</View>
	);
}

export function AssistantTurn({ item, showThinking, statusLine }: { item: Extract<TranscriptItem, { kind: "assistant" }>; showThinking: boolean; statusLine?: string }) {
	return (
		<View className="mb-5">
			<View className="mb-2.5 flex-row items-center gap-2">
				<View className="h-6 w-6 items-center justify-center rounded-full bg-vetta-green">
					<Text className="text-[11px] font-bold text-[#08110b]">V</Text>
				</View>
				<Text className="text-[13px] font-semibold text-ink">Vetta</Text>
				{statusLine ? <Text className="text-[12px] text-dim">{statusLine}</Text> : null}
			</View>
			{showThinking ? <ThinkingBlock text={item.thinking} live={item.streaming && !item.text} /> : null}
			{item.tools.map((tool) => (
				<ToolCard key={tool.toolCallId} tool={tool} />
			))}
			{item.text ? (
				<View className="mt-1">
					<Markdown text={item.text} />
				</View>
			) : null}
			{item.error ? (
				<Text className="mt-1 text-[13px] text-vetta-red">
					{t.chat.errorPrefix}
					{item.error}
				</Text>
			) : null}
		</View>
	);
}

export function MarkerRow({ text }: { text: string }) {
	return (
		<View className="mb-4 items-center">
			<Text className="text-[11px] text-faint">{text}</Text>
		</View>
	);
}

export function QuestionCard({
	request,
	onSubmit,
	onSkip,
}: {
	request: RemoteQuestionRequest;
	onSubmit: (answers: readonly RemoteQuestionAnswer[]) => void;
	onSkip: () => void;
}) {
	const { colors } = useTheme();
	const [selected, setSelected] = useState<Record<number, string[]>>({});
	const toggle = (index: number, label: string, multi: boolean) => {
		setSelected((current) => {
			const existing = current[index] ?? [];
			if (!multi) return { ...current, [index]: [label] };
			return { ...current, [index]: existing.includes(label) ? existing.filter((value) => value !== label) : [...existing, label] };
		});
	};
	const complete = request.questions.every((_, index) => (selected[index]?.length ?? 0) > 0);
	return (
		<View className="mb-5 rounded-[20px] border border-[rgba(245,158,11,0.35)] bg-card p-4">
			<Text className="text-[12px] font-semibold text-vetta-orange">{t.chat.questionTitle}</Text>
			{request.questions.map((question, index) => (
				<View key={`${question.header}-${index}`} className="mt-3">
					<Text className="text-[15px] font-semibold text-ink">{question.question}</Text>
					{question.header ? <Text className="mt-0.5 text-[12px] text-dim">{question.header}</Text> : null}
					<View className="mt-2.5 gap-2">
						{question.options.map((option) => {
							const active = (selected[index] ?? []).includes(option.label);
							return (
								<Pressable
									key={option.label}
									accessibilityRole="button"
									accessibilityState={{ selected: active }}
									onPress={() => toggle(index, option.label, question.multiSelect === true)}
									className={`flex-row items-center rounded-2xl border px-3.5 py-3 ${active ? "border-vetta-green bg-vetta-green-soft" : "border-line bg-card-2"}`}
								>
									<View className="flex-1">
										<Text className="text-[14px] font-medium text-ink">{option.label}</Text>
										{option.description ? <Text className="mt-0.5 text-[12px] text-dim">{option.description}</Text> : null}
									</View>
									{active ? <Check size={16} color={palette.green} strokeWidth={2.2} /> : null}
								</Pressable>
							);
						})}
					</View>
				</View>
			))}
			<View className="mt-4 flex-row justify-end gap-2">
				<Pressable accessibilityRole="button" onPress={onSkip} className="rounded-full px-4 py-2.5">
					<Text className="text-[13px] text-dim">{t.chat.questionSkip}</Text>
				</Pressable>
				<Pressable
					accessibilityRole="button"
					disabled={!complete}
					onPress={() =>
						onSubmit(request.questions.map((question, index) => ({ question: question.question, answers: selected[index] ?? [] })))
					}
					className={`rounded-full px-5 py-2.5 ${complete ? "bg-pill" : "bg-card-2"}`}
				>
					<Text className={`text-[13px] font-semibold ${complete ? "text-pill-ink" : "text-faint"}`} style={complete ? undefined : { color: colors.faint }}>
						{t.chat.questionSubmit}
					</Text>
				</Pressable>
			</View>
		</View>
	);
}
