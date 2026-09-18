import { useModelOptions } from "@shared/components/ModelSelect/useModelOptions";
import { useMemo, useRef } from "react";
import { collectModelSwitchLabels, userModelSwitchFingerprint } from "../components/message-list/message-list-derived";
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
	const modelSwitchFingerprint = userModelSwitchFingerprint(messages);
	const modelSwitchCacheRef = useRef<{
		fingerprint: string;
		modelNames: ReadonlyMap<string, string>;
		labels: Map<string, string>;
	}>({ fingerprint: "", modelNames: new Map(), labels: new Map() });
	const modelSwitchCache = modelSwitchCacheRef.current;
	if (modelSwitchCache.fingerprint !== modelSwitchFingerprint || modelSwitchCache.modelNames !== modelNames) {
		modelSwitchCacheRef.current = {
			fingerprint: modelSwitchFingerprint,
			modelNames,
			labels: collectModelSwitchLabels(messages, modelNames),
		};
	}
	const modelSwitchLabels = modelSwitchCacheRef.current.labels;

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
