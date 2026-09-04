import {
	activeSessionAtom,
	appshotAttachmentAtom,
	focusInputRequestAtom,
	getTodoItemsForSession,
	inputValueAtom,
	isStreamingAtom,
	mentionedFilesAtom,
	pendingMcpElicitationsAtom,
	pendingMessageEditAtom,
	pendingQuestionsAtom,
	promptAttachmentAtom,
	promptSuggestionsAtom,
	sandboxPermissionDrawerAtom,
	todoItemsBySessionAtom,
} from "@shared/store/atoms";
import { filePreviewAtom } from "@shared/store/file-preview-atoms";
import {
	getQueueForSession,
	isQueuePausedForSession,
	messageQueueBySessionAtom,
	messageQueuePausedBySessionAtom,
} from "@shared/store/message-queue-atoms";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useMemo } from "react";
import { inputBlankAtom, inputImagePathsAtom, inputPlaceholderVisibleAtom } from "./editor/tokens/projectionAtoms";

export function useInputBarSessionSource(cwdOverride?: string) {
	const activeSession = useAtomValue(activeSessionAtom);
	const isStreaming = useAtomValue(isStreamingAtom);
	const isBlank = useAtomValue(inputBlankAtom);
	const placeholderVisible = useAtomValue(inputPlaceholderVisibleAtom);
	const focusInputRequest = useAtomValue(focusInputRequestAtom);
	const effectiveCwd = activeSession?.cwd ?? cwdOverride ?? "";
	const hasSession = Boolean(activeSession) || Boolean(cwdOverride);

	return {
		activeSession,
		effectiveCwd,
		focusInputRequest,
		hasSession,
		isBlank,
		isStreaming,
		placeholderVisible,
	};
}

export function useInputBarDraftSource() {
	const [promptAttachment, setPromptAttachment] = useAtom(promptAttachmentAtom);
	const [appshotAttachment, setAppshotAttachment] = useAtom(appshotAttachmentAtom);
	const [pendingMessageEdit, setPendingMessageEdit] = useAtom(pendingMessageEditAtom);
	const imagePaths = useAtomValue(inputImagePathsAtom);

	return {
		appshotAttachment,
		imagePaths,
		pendingMessageEdit,
		promptAttachment,
		setAppshotAttachment,
		setFilePreview: useSetAtom(filePreviewAtom),
		setInputValue: useSetAtom(inputValueAtom),
		setMentionedFiles: useSetAtom(mentionedFilesAtom),
		setPendingMessageEdit,
		setPromptAttachment,
	};
}

export function useInputBarInteractionSource(runtimeId?: string | readonly string[]) {
	const pendingQuestions = useAtomValue(pendingQuestionsAtom);
	const pendingMcpElicitations = useAtomValue(pendingMcpElicitationsAtom);
	const sandboxPermission = useAtomValue(sandboxPermissionDrawerAtom);
	const runtimeIds =
		runtimeId === undefined ? undefined : new Set(typeof runtimeId === "string" ? [runtimeId] : runtimeId);
	const scopedRuntimeIds = runtimeIds ? [...runtimeIds] : [];
	const primaryRuntimeId = typeof runtimeId === "string" ? runtimeId : scopedRuntimeIds[0];
	const pendingQuestionRuntimeId = scopedRuntimeIds.find((id) => pendingQuestions[id]);
	const pendingMcpRuntimeId = scopedRuntimeIds.find((id) => pendingMcpElicitations[id]);
	return {
		pendingMcpElicitation: runtimeIds
			? pendingMcpRuntimeId
				? pendingMcpElicitations[pendingMcpRuntimeId]
				: undefined
			: primaryRuntimeId
				? pendingMcpElicitations[primaryRuntimeId]
				: undefined,
		pendingQuestion: runtimeIds
			? pendingQuestionRuntimeId
				? pendingQuestions[pendingQuestionRuntimeId]
				: undefined
			: primaryRuntimeId
				? pendingQuestions[primaryRuntimeId]
				: undefined,
		sandboxPermission:
			sandboxPermission && (runtimeIds === undefined || runtimeIds.has(sandboxPermission.runtimeId))
				? sandboxPermission
				: null,
	};
}

export function useInputBarSuggestionSource(runtimeId?: string): string | undefined {
	const suggestions = useAtomValue(promptSuggestionsAtom);
	return runtimeId ? suggestions[runtimeId]?.[0] : undefined;
}

export function useInputBarQueueSource(runtimeId?: string) {
	const queueMap = useAtomValue(messageQueueBySessionAtom);
	const pausedMap = useAtomValue(messageQueuePausedBySessionAtom);
	return {
		items: useMemo(() => getQueueForSession(queueMap, runtimeId ?? null), [queueMap, runtimeId]),
		paused: isQueuePausedForSession(pausedMap, runtimeId ?? null),
	};
}

export function useInputBarTodoSource(runtimeId?: string) {
	const todoMap = useAtomValue(todoItemsBySessionAtom);
	return useMemo(() => getTodoItemsForSession(todoMap, runtimeId ?? null), [todoMap, runtimeId]);
}
