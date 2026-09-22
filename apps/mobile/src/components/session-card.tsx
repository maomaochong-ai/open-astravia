import type { RemoteSessionSummary } from "@vetta/remote-control";
import { CircleAlert } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { t } from "../i18n/strings";
import { formatRelativeTime } from "../remote/relative-time";
import { palette } from "../theme/colors";
import { useTheme } from "../theme/use-theme";
import { Divider, StatusDot } from "./ui";

export function describeStatus(status: RemoteSessionSummary["status"]): { label: string; tone: "green" | "orange" | "dim" | "red" } {
	switch (status) {
		case "running":
			return { label: t.home.statusRunning, tone: "green" };
		case "thinking":
			return { label: t.home.statusThinking, tone: "green" };
		case "waiting_input":
			return { label: t.home.statusWaiting, tone: "orange" };
		case "error":
			return { label: t.home.statusError, tone: "red" };
		case "aborted":
			return { label: t.home.statusAborted, tone: "dim" };
		default:
			return { label: t.home.statusDone, tone: "dim" };
	}
}

export function SessionCard({ session, onPress, last }: { session: RemoteSessionSummary; onPress: () => void; last?: boolean }) {
	const { colors } = useTheme();
	const status = describeStatus(session.status);
	const tint = status.tone === "green" ? palette.green : status.tone === "orange" ? palette.orange : status.tone === "red" ? palette.red : colors.dim;
	const active = status.tone === "green";
	return (
		<Pressable accessibilityRole="button" onPress={onPress} className="active:opacity-80">
			<View className="py-4">
				<View className="flex-row items-center justify-between">
					<View className="flex-row items-center gap-1.5">
						{status.tone === "orange" ? <CircleAlert size={13} color={palette.orange} strokeWidth={2} /> : <StatusDot color={tint} size={6} />}
						<Text className="text-[12px]" style={{ color: tint }}>
							{status.label}
						</Text>
					</View>
					<Text className="text-[12px] text-dim">{formatRelativeTime(session.updatedAt)}</Text>
				</View>
				<Text className="mt-2 text-[17px] font-semibold text-ink" numberOfLines={2}>
					{session.title.trim() || t.home.untitled}
				</Text>
				{session.preview ? (
					<Text className="mt-1.5 text-[14px] leading-5 text-dim" numberOfLines={2}>
						{session.preview}
					</Text>
				) : null}
				{active ? (
					<View className="mt-3 h-[3px] overflow-hidden rounded-full bg-line">
						<View className="h-full w-3/4 rounded-full bg-vetta-green" />
					</View>
				) : null}
			</View>
			{!last ? <Divider /> : null}
		</Pressable>
	);
}
