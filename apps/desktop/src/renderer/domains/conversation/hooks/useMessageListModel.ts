import { useModelOptions } from "@shared/components/ModelSelect/useModelOptions";
import { useMemo } from "react";
import type { MessageListModel, MessageListProps } from "../components/message-list/types";
import { useMessageListScrollModel } from "./useMessageListScrollModel";

export function useMessageListModel({
	messages,
	isStreaming,
	sessionId,
	initialTargetKey,
	onInitialTargetHandled,
	participants = [],
	onTeamMemberOpen,
}: MessageListProps): MessageListModel {
	const scroll = useMessageListScrollModel({
		isStreaming,
		messages,
		sessionId,
		initialTargetKey,
		onInitialTargetHandled,
	});
	const { options } = useModelOptions();
	const modelNames = useMemo(() => new Map(options.map((option) => [option.key, option.displayName])), [options]);
	const modelSwitchLabels = useMemo(() => {
		const switches = new Map<string, string>();
		let previousKey: string | null = null;
		for (const message of messages) {
			if (message.kind !== "user") continue;
			const key = message.model ? `${message.model.provider}/${message.model.id}` : null;
			if (key && previousKey && key !== previousKey) {
				switches.set(message.id, modelNames.get(key) ?? key);
			}
			if (key) previousKey = key;
		}
		return switches;
	}, [messages, modelNames]);

	const participantsById = useMemo(
		() => new Map(participants.map((participant) => [participant.id, participant])),
		[participants],
	);
	return {
		isStreaming,
		messages,
		modelSwitchLabels,
		scroll,
		tailMessageId: messages.at(-1)?.id ?? null,
		participantsById,
		participants,
		onTeamMemberOpen,
	};
}
