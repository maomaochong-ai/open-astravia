import { useModelOptions } from "@shared/components/ModelSelect/useModelOptions";
import { isCompactingAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import type { MessageListModel, MessageListProps } from "../components/message-list/types";
import { useMessageListScrollModel } from "./useMessageListScrollModel";

export function useMessageListModel({ messages, isStreaming, sessionId }: MessageListProps): MessageListModel {
	const isCompacting = useAtomValue(isCompactingAtom);
	const scroll = useMessageListScrollModel({ isStreaming, messages, sessionId });
	const { options } = useModelOptions();
	const modelNames = useMemo(() => new Map(options.map((option) => [option.key, option.displayName])), [options]);
	const modelSwitchLabels = useMemo(() => {
		const switches = new Map<string, string>();
		let previousKey: string | null = null;
		for (const message of messages) {
			if (message.role !== "user") continue;
			const key = message.model ? `${message.model.provider}/${message.model.id}` : null;
			if (key && previousKey && key !== previousKey) {
				switches.set(message.id, modelNames.get(key) ?? key);
			}
			if (key) previousKey = key;
		}
		return switches;
	}, [messages, modelNames]);

	return {
		isCompacting,
		isStreaming,
		messages,
		modelSwitchLabels,
		scroll,
		showWaiting: isStreaming && messages.at(-1)?.role !== "assistant",
		tailMessageId: messages.at(-1)?.id ?? null,
	};
}
