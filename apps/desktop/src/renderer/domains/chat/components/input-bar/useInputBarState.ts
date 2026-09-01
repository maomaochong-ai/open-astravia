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
import { useInputActionBarModel } from "../useInputActionBarModel";
// These projections avoid subscribing to the full input atom on every keystroke.
import { inputBlankAtom, inputImagePathsAtom, inputPlaceholderVisibleAtom } from "./editor/tokens/projectionAtoms";
import { useSpeechInput } from "./useSpeechInput";

/**
 * InputBar 的业务状态组合器。
 *
 * 这里集中处理 atom 订阅和按会话派生的状态；事件处理、编辑器命令和展示文案
 * 分别由其他 model 负责。这样普通聊天和其他 composer host 可以复用同一组状态
 * 能力，而不必复制一个巨大的连接型 hook。
 */
export function useInputBarState({
	cwdOverride,
	hasSessionOverride,
	isStreamingOverride,
}: {
	cwdOverride?: string;
	hasSessionOverride?: boolean;
	isStreamingOverride?: boolean;
}) {
	const isBlank = useAtomValue(inputBlankAtom);
	const placeholderVisible = useAtomValue(inputPlaceholderVisibleAtom);
	const atomIsStreaming = useAtomValue(isStreamingAtom);
	const isStreaming = isStreamingOverride ?? atomIsStreaming;
	const activeSession = useAtomValue(activeSessionAtom);
	const pendingQuestions = useAtomValue(pendingQuestionsAtom);
	const pendingQuestion = activeSession?.runtimeId ? pendingQuestions[activeSession.runtimeId] : undefined;
	const pendingMcpElicitations = useAtomValue(pendingMcpElicitationsAtom);
	const pendingMcpElicitation = activeSession?.runtimeId ? pendingMcpElicitations[activeSession.runtimeId] : undefined;
	const promptSuggestions = useAtomValue(promptSuggestionsAtom);
	const firstSuggestion = activeSession?.runtimeId ? promptSuggestions[activeSession.runtimeId]?.[0] : undefined;
	const [promptAttachment, setPromptAttachment] = useAtom(promptAttachmentAtom);
	const [appshotAttachment, setAppshotAttachment] = useAtom(appshotAttachmentAtom);
	const [pendingMessageEdit, setPendingMessageEdit] = useAtom(pendingMessageEditAtom);
	const setInputValue = useSetAtom(inputValueAtom);
	const setMentionedFiles = useSetAtom(mentionedFilesAtom);
	const imagePaths = useAtomValue(inputImagePathsAtom);
	const setFilePreview = useSetAtom(filePreviewAtom);
	const focusInputRequest = useAtomValue(focusInputRequestAtom);
	const todoMap = useAtomValue(todoItemsBySessionAtom);
	const sandboxPermission = useAtomValue(sandboxPermissionDrawerAtom);
	const todoItems = useMemo(
		() => getTodoItemsForSession(todoMap, activeSession?.runtimeId ?? null),
		[todoMap, activeSession?.runtimeId],
	);
	const queueMap = useAtomValue(messageQueueBySessionAtom);
	const queueItems = useMemo(
		() => getQueueForSession(queueMap, activeSession?.runtimeId ?? null),
		[queueMap, activeSession?.runtimeId],
	);
	const queuePausedMap = useAtomValue(messageQueuePausedBySessionAtom);
	const queuePaused = isQueuePausedForSession(queuePausedMap, activeSession?.runtimeId ?? null);
	const actionBar = useInputActionBarModel();

	const effectiveCwd = activeSession?.cwd ?? cwdOverride ?? "";
	const hasSession = hasSessionOverride ?? (Boolean(activeSession) || Boolean(cwdOverride));
	const canSend = hasSession && !isStreaming && (!isBlank || Boolean(appshotAttachment));
	const speechInput = useSpeechInput(hasSession);

	return {
		activeSession,
		actionBar,
		appshotAttachment,
		canSend,
		effectiveCwd,
		firstSuggestion,
		focusInputRequest,
		hasSession,
		imagePaths,
		isBlank,
		isEmpty: isBlank,
		isStreaming,
		pendingMcpElicitation,
		pendingMessageEdit,
		pendingQuestion,
		placeholderVisible,
		promptAttachment,
		queueItems,
		queuePaused,
		sandboxPermission,
		speechInput,
		todoItems,
		setAppshotAttachment,
		setFilePreview,
		setInputValue,
		setMentionedFiles,
		setPendingMessageEdit,
		setPromptAttachment,
	};
}
