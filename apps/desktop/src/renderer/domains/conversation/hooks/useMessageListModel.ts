import { useModelOptions } from "@shared/components/ModelSelect/useModelOptions";
import { useMemo, useRef } from "react";
import type { ModelSwitchLabel } from "../components/message-list/message-list-derived";
import { collectModelSwitchLabels, userModelSwitchFingerprint } from "../components/message-list/message-list-derived";
import type { MessageListModel, MessageListProps } from "../components/message-list/types";
import type { MessageListScrollModel } from "./useMessageListScrollModel";

const EMPTY_PARTICIPANTS: NonNullable<MessageListProps["participants"]> = [];

export function useMessageListModel(
	{ messages, isStreaming, participants, onTeamMemberOpen }: MessageListProps,
	scroll: MessageListScrollModel,
	derivationMessages: MessageListProps["messages"],
): MessageListModel {
	const resolvedParticipants = participants ?? EMPTY_PARTICIPANTS;
	const { options } = useModelOptions();
	const modelNames = useMemo(() => new Map(options.map((option) => [option.key, option.displayName])), [options]);
	const modelSwitchFingerprint = userModelSwitchFingerprint(derivationMessages);
	const modelSwitchCacheRef = useRef<{
		fingerprint: string;
		modelNames: ReadonlyMap<string, string>;
		labels: Map<string, ModelSwitchLabel>;
	}>({ fingerprint: "", modelNames: new Map(), labels: new Map() });
	const modelSwitchCache = modelSwitchCacheRef.current;
	if (modelSwitchCache.fingerprint !== modelSwitchFingerprint || modelSwitchCache.modelNames !== modelNames) {
		modelSwitchCacheRef.current = {
			fingerprint: modelSwitchFingerprint,
			modelNames,
			labels: collectModelSwitchLabels(derivationMessages, modelNames),
		};
	}
	const modelSwitchLabels = modelSwitchCacheRef.current.labels;

	const participantsById = useMemo(
		() => new Map(resolvedParticipants.map((participant) => [participant.id, participant])),
		[resolvedParticipants],
	);
	return useMemo(
		() => ({
			isStreaming,
			messages,
			modelSwitchLabels,
			scroll,
			tailMessageId: messages.at(-1)?.id ?? null,
			participantsById,
			participants: resolvedParticipants,
			onTeamMemberOpen,
		}),
		[isStreaming, messages, modelSwitchLabels, onTeamMemberOpen, participantsById, resolvedParticipants, scroll],
	);
}
