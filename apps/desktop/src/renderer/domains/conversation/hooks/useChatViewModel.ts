import { useSshHost } from "@shared/hooks/useSshHost";
import {
	activeSessionAtom,
	activeSessionCwdAtom,
	activityPanelOpenAtom,
	applyInputActionWorkingState,
	bottomPanelStateAtom,
	captureInputActionWorkingState,
	chatMessagesAtom,
	closeInlineFilePreviewAtom,
	defaultConversationCwdAtom,
	dispatchBottomPanelAtom,
	emptySessionInputActionState,
	getProjectDisplayName,
	inlineFilePreviewContextReadonlyAtom,
	isConversationBusyAtom,
	loadInputActionStateForSession,
	pageHeaderTitleAtom,
	pageHeaderTitleBadgeAtom,
	pendingSessionCreationAtom,
	pendingSessionOpenAtom,
	persistCurrentInputActionState,
	persistInputActionStateForSession,
	promptAttachmentAtom,
	sessionDisplayLabel,
	sessionsMapAtom,
	syncHardIsolationContributionModes,
} from "@shared/store/atoms";
import { parseProjectLocation } from "@vetta/ssh-transport/project-uri";
import { useThemeSurface } from "@vetta-org/theme-sdk/appearance";
import { RemoteSessionBadgeView } from "@vetta-org/theme-ui/chat";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { selectAtom } from "jotai/utils";
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOpenTerminal } from "../../bottom-panel/hooks/useOpenTerminal";
import type { ChatViewModelResult } from "../components/chat-view/types";

/**
 * ChatView 只需要当前会话的 path / cwd。订阅 activeSession 整个对象会让流式期间
 * 的任意字段变动（token 计数、运行态）把 ChatView 整棵树连带 header slot 写入
 * 一起重跑，低配机上发送时的级联提交主要来自这里。
 */
const activeSessionPathAtom = selectAtom(activeSessionAtom, (session) => session?.sessionPath ?? null);

export function useChatViewModel(): ChatViewModelResult {
	const { t } = useTranslation("chat");
	const surface = useThemeSurface("chat.view");
	const activeSessionPath = useAtomValue(activeSessionPathAtom);
	const activeSessionCwd = useAtomValue(activeSessionCwdAtom);
	const pendingSessionOpen = useAtomValue(pendingSessionOpenAtom);
	const pendingSessionCreation = useAtomValue(pendingSessionCreationAtom);
	const messages = useAtomValue(chatMessagesAtom);
	const isStreaming = useAtomValue(isConversationBusyAtom);
	const [panelOpen, setPanelOpen] = useAtom(activityPanelOpenAtom);
	const setHeaderTitle = useSetAtom(pageHeaderTitleAtom);
	const setHeaderTitleBadge = useSetAtom(pageHeaderTitleBadgeAtom);
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
		const nextPath = activeSessionPath || null;
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
	}, [activeSessionPath, setPromptAttachment]);

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
	// 底部面板的展开态是会话级持久化状态，所以读写都走它自己的 atom，
	// 不在这里再存一份 useState。
	const bottomPanelState = useAtomValue(bottomPanelStateAtom);
	const dispatchBottomPanel = useSetAtom(dispatchBottomPanelAtom);
	const bottomPanelOpen = !bottomPanelState.collapsed;
	const toggleBottomPanel = useCallback(() => {
		dispatchBottomPanel({ type: "set-collapsed", collapsed: bottomPanelOpen });
	}, [dispatchBottomPanel, bottomPanelOpen]);
	const terminal = useOpenTerminal();
	const openTerminal = terminal.open;

	const togglePanel = useCallback(() => {
		if (inlinePreviewActive) {
			closeInlinePreview();
			setPanelOpen(false);
			return;
		}
		setPanelOpen((open) => !open);
	}, [closeInlinePreview, inlinePreviewActive, setPanelOpen]);

	const sessionTitle = useMemo(() => {
		if (activeSessionPath === null && activeSessionCwd === null) return null;
		for (const list of sessionsMap.values()) {
			const found = list.find((session) => session.path === activeSessionPath);
			if (found) return sessionDisplayLabel(found);
		}
		return getProjectDisplayName(activeSessionCwd ?? "", defaultCwd);
	}, [activeSessionPath, activeSessionCwd, defaultCwd, sessionsMap]);

	useEffect(() => {
		setHeaderTitle(sessionTitle);
		return () => setHeaderTitle(null);
	}, [sessionTitle, setHeaderTitle]);

	// 远程（SSH）会话在标题右侧挂一枚徽标：会话名本身不带主机信息，用户切来切去时很容易
	// 把远端会话当成本地会话误操作。徽标上直接写主机名——同时开着好几台远端时，只写「远程」
	// 等于没说，而用户真正要确认的是「这条命令要跑在哪台机器上」。
	const remoteLocation = useMemo(() => {
		if (!activeSessionCwd) return null;
		const location = parseProjectLocation(activeSessionCwd);
		return location.kind === "ssh" ? location : null;
	}, [activeSessionCwd]);
	const remoteHost = useSshHost(remoteLocation?.hostId);

	useEffect(() => {
		if (!remoteLocation) {
			setHeaderTitleBadge(null);
			return;
		}
		// 主机名要等主进程回话；这一瞬以及主机已被删除时退回「远程」，不把 hostId 那串
		// UUID 摆给用户看。
		const label = remoteHost?.label ?? t("chatView.remoteBadge");
		// 名字可以重复也可以改，连接目标才是唯一没有歧义的那个，所以两者都进悬停提示。
		const origin = remoteHost === undefined ? remoteLocation.hostId : `${remoteHost.label} (${remoteHost.target})`;
		setHeaderTitleBadge(
			createElement(RemoteSessionBadgeView, {
				label,
				title: `${origin}:${remoteLocation.remotePath}`,
			}),
		);
		return () => setHeaderTitleBadge(null);
	}, [remoteHost, remoteLocation, setHeaderTitleBadge, t]);

	// actions / header 保持引用稳定：ChatView 用它们 memo 出 header slot 元素并写进
	// 全局 pageHeader atom；若每次渲染都换引用，发送/流式期间每条消息都会级联一次
	// RootLayout header 提交。
	const actions = useMemo(
		() => ({
			finishExport,
			openExport,
			togglePanel,
			toggleBottomPanel,
			openTerminal,
			togglePin,
		}),
		[finishExport, openExport, togglePanel, toggleBottomPanel, openTerminal, togglePin],
	);

	const hasMessages = messages.length > 0;
	const header = useMemo(
		() => ({
			exportDisabled: !hasMessages || isStreaming || exporting,
			exporting,
			exportTitle: t("chatView.exportButton.title"),
			panelOpen,
			panelTitle: panelOpen ? t("chatView.panelButton.open") : t("chatView.panelButton.closed"),
			bottomPanelOpen,
			bottomPanelTitle: bottomPanelOpen
				? t("chatView.bottomPanelButton.open")
				: t("chatView.bottomPanelButton.closed"),
			terminalAvailable: terminal.available,
			terminalFocused: terminal.focused,
			terminalTitle: !terminal.available
				? t("chatView.terminalButton.unavailable")
				: terminal.focused
					? t("chatView.terminalButton.focused")
					: t("chatView.terminalButton.open"),
			pinTitle: pinned ? t("chatView.pinButton.pinned") : t("chatView.pinButton.unpinned"),
			pinned,
		}),
		[
			bottomPanelOpen,
			exporting,
			hasMessages,
			isStreaming,
			panelOpen,
			pinned,
			t,
			terminal.available,
			terminal.focused,
		],
	);

	return {
		actions,
		model: {
			cwd: activeSessionCwd,
			exporting,
			exportTitle: sessionTitle ?? t("chatView.defaultSessionTitle"),
			header,
			isStreaming,
			messages,
			pendingLabel: pendingSessionCreation ? t("messageList.assistantMessage.creatingSession") : undefined,
			rootClassName: surface?.rootClassName,
			// pending path is the visual identity. It avoids old -> null -> target
			// Virtuoso resets while Runtime-bound activeSession is intentionally absent.
			sessionId: pendingSessionOpen?.sessionPath ?? activeSessionPath,
		},
	};
}
