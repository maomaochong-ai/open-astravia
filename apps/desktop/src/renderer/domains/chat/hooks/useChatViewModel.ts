import {
	activeSessionAtom,
	activityPanelOpenAtom,
	applyInputActionWorkingState,
	captureInputActionWorkingState,
	chatMessagesAtom,
	closeInlineFilePreviewAtom,
	defaultConversationCwdAtom,
	emptySessionInputActionState,
	getProjectDisplayName,
	inlineFilePreviewContextReadonlyAtom,
	isStreamingAtom,
	loadInputActionStateForSession,
	pageHeaderTitleAtom,
	persistCurrentInputActionState,
	persistInputActionStateForSession,
	promptAttachmentAtom,
	sessionDisplayLabel,
	sessionsMapAtom,
	syncHardIsolationContributionModes,
} from "@shared/store/atoms";
import { useThemeSurface } from "@vetta/theme-sdk/appearance";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatViewModelResult } from "../components/chat-view/types";

export function useChatViewModel(): ChatViewModelResult {
	const { t } = useTranslation("chat");
	const surface = useThemeSurface("chat.view");
	const activeSession = useAtomValue(activeSessionAtom);
	const messages = useAtomValue(chatMessagesAtom);
	const isStreaming = useAtomValue(isStreamingAtom);
	const [panelOpen, setPanelOpen] = useAtom(activityPanelOpenAtom);
	const setHeaderTitle = useSetAtom(pageHeaderTitleAtom);
	const inlinePreviewActive = useAtomValue(inlineFilePreviewContextReadonlyAtom) !== null;
	const closeInlinePreview = useSetAtom(closeInlineFilePreviewAtom);
	const defaultCwd = useAtomValue(defaultConversationCwdAtom);
	const sessionsMap = useAtomValue(sessionsMapAtom);
	const setPromptAttachment = useSetAtom(promptAttachmentAtom);

	// 按 sessionPath 恢复 / 切换 AI 输入栏 toggle（插件 input-action + 知识检索）。
	// undefined = 尚未挂载；null = 无有效 sessionPath（新建页或 early open 的空 path）。
	// 落盘主要在 toggle 时完成；此处负责切会话时保存上一会话工作集并加载下一会话。
	// 不在 unmount 落盘：NewSession 会先清工作集，unmount 再写会把空状态覆盖旧会话。
	const prevSessionPathRef = useRef<string | null | undefined>(undefined);

	useEffect(() => {
		const nextPath = activeSession?.sessionPath || null;
		const prevPath = prevSessionPathRef.current;

		if (prevPath === undefined) {
			// ChatView 首次挂载：优先保留新建页草稿（工作集非空），否则从持久化恢复。
			prevSessionPathRef.current = nextPath;
			if (!nextPath) return;
			const working = captureInputActionWorkingState();
			const hasDraft = working.actionIds.length > 0 || working.knowledgeRetrieval;
			if (hasDraft) {
				persistInputActionStateForSession(nextPath, working);
				syncHardIsolationContributionModes(new Set(working.actionIds));
			} else {
				applyInputActionWorkingState(loadInputActionStateForSession(nextPath));
			}
			return;
		}

		if (prevPath === nextPath) return;

		// 插件 prompt attachment 是一次性的，不跨会话。
		setPromptAttachment(null);

		if (prevPath) {
			persistCurrentInputActionState(prevPath);
		}

		if (nextPath) {
			if (prevPath === null) {
				// 新建会话首条消息落地 path：认领当前工作集，不覆盖为空。
				const working = captureInputActionWorkingState();
				persistInputActionStateForSession(nextPath, working);
				syncHardIsolationContributionModes(new Set(working.actionIds));
			} else {
				applyInputActionWorkingState(loadInputActionStateForSession(nextPath));
			}
		} else {
			applyInputActionWorkingState(emptySessionInputActionState());
		}

		prevSessionPathRef.current = nextPath;
	}, [activeSession?.sessionPath, setPromptAttachment]);

	const [pinned, setPinned] = useState(false);
	const [exporting, setExporting] = useState(false);
	useEffect(() => {
		void window.vetta.window.isAlwaysOnTop().then(setPinned);
	}, []);

	const togglePin = useCallback(async () => {
		const next = await window.vetta.window.toggleAlwaysOnTop();
		setPinned(next);
	}, []);
	const finishExport = useCallback(() => setExporting(false), []);
	const openExport = useCallback(() => setExporting(true), []);
	const togglePanel = useCallback(() => {
		if (inlinePreviewActive) {
			closeInlinePreview();
			setPanelOpen(false);
			return;
		}
		setPanelOpen((open) => !open);
	}, [closeInlinePreview, inlinePreviewActive, setPanelOpen]);

	const sessionTitle = useMemo(() => {
		if (!activeSession) return null;
		for (const list of sessionsMap.values()) {
			const found = list.find((session) => session.path === activeSession.sessionPath);
			if (found) return sessionDisplayLabel(found);
		}
		return getProjectDisplayName(activeSession.cwd, defaultCwd);
	}, [activeSession, defaultCwd, sessionsMap]);

	useEffect(() => {
		setHeaderTitle(sessionTitle);
		return () => setHeaderTitle(null);
	}, [sessionTitle, setHeaderTitle]);

	return {
		actions: {
			finishExport,
			openExport,
			togglePanel,
			togglePin,
		},
		model: {
			exporting,
			exportTitle: sessionTitle ?? t("chatView.defaultSessionTitle"),
			header: {
				exportDisabled: messages.length === 0 || isStreaming || exporting,
				exporting,
				exportTitle: t("chatView.exportButton.title"),
				panelOpen,
				panelTitle: panelOpen ? t("chatView.panelButton.open") : t("chatView.panelButton.closed"),
				pinTitle: pinned ? t("chatView.pinButton.pinned") : t("chatView.pinButton.unpinned"),
				pinned,
			},
			isStreaming,
			messages,
			rootClassName: surface?.rootClassName,
			sessionId: activeSession?.sessionPath ?? null,
		},
	};
}
