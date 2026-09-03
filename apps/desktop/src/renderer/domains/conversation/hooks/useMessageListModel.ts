import { useModelOptions } from "@shared/components/ModelSelect/useModelOptions";
import { activeSessionAtom, isCompactingAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import type { MessageListModel, MessageListProps } from "../components/message-list/types";
import { useMessageListScrollModel } from "./useMessageListScrollModel";

const DEFAULT_CONTEXT: NonNullable<MessageListProps["context"]> = {
	inheritActiveSession: true,
	showRuntimeFooter: true,
	showSuggestions: true,
	userMessageActions: { edit: true, fork: true, delete: true },
};

export function useMessageListModel({
	messages,
	isStreaming,
	sessionId,
	participants = [],
	context = DEFAULT_CONTEXT,
}: MessageListProps): MessageListModel {
	const isCompacting = useAtomValue(isCompactingAtom);
	const activeSession = useAtomValue(activeSessionAtom);
	const scroll = useMessageListScrollModel({ isStreaming, messages, sessionId });
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

	return {
		parentEntryId: context.inheritActiveSession ? activeSession?.parentEntryId : undefined,
		parentSessionPath: context.inheritActiveSession ? activeSession?.parentSessionPath : undefined,
		isCompacting,
		isStreaming,
		messages,
		modelSwitchLabels,
		scroll,
		waitingForResponse: isStreaming && messages.at(-1)?.kind !== "agent",
		tailMessageId: messages.at(-1)?.id ?? null,
		participantsById: new Map(participants.map((participant) => [participant.id, participant])),
		context,
	};
}
