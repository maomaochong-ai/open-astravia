import { useProjectActions } from "@domains/project/hooks/useProjects";
import { i18n } from "@shared/i18n";
import {
	activeSessionAtom,
	activeToolNamesAtom,
	applyInputActionWorkingState,
	attachedImagesAtom,
	authUserAtom,
	confirmDialogAtom,
	contextUsageAtom,
	currentScenarioAtom,
	emptySessionInputActionState,
	lastActiveSessionAtom,
	newSessionInputDraftKey,
	pageHeaderTitleAtom,
	pageHeaderTitleBadgeAtom,
	pageHeaderTitleHiddenAtom,
	pendingSessionCreationAtom,
	promptAttachmentAtom,
	sessionExecutionModeAtom,
	switchSessionInputDraftScope,
} from "@shared/store/atoms";
import { useParams } from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import { startTransition, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionManager } from "../../hooks/useSessionManager";
import { useSkillList } from "../../hooks/useSkillList";
import type { SendInteractionContext } from "../input-bar/types";
import { PANEL_SHIFT_MIN_ITEMS } from "./constants";
import { prepareProjectCwd } from "./project-selector/prepare-project-cwd";
import type { ProjectOption, ProjectSelection } from "./project-selector/project-selection";
import { useNewSessionProjectSelection } from "./project-selector/useNewSessionProjectSelection";
import { useNewSessionActivityPanel } from "./useNewSessionActivityPanel";
import { useNewSessionSend } from "./useNewSessionSend";
import { useShortViewport } from "./useShortViewport";

interface NewSessionPageModel {
	/** 右侧活动面板是否展开（与会话页、项目详情页共用同一状态）。 */
	activityOpen: boolean;
	avatarAutoplay: boolean;
	/** 命令区（`/` 或「+」展开）是否打开：hero 随之淡出让位。 */
	commandPanelExpanded: boolean;
	/**
	 * 输入栏是否要为命令区下沉。
	 * 条目少时面板长不到会盖住 hero 的高度，那趟位移纯属多余，因此不跟 expanded 一致。
	 */
	commandPanelShift: boolean;
	cwd: string;
	/** 活动面板根目录；「对话」与待创建项目下为 null，文件面板走空态而不是暴露 conversation 根。 */
	activityPanelCwd: string | null;
	greetingTitle: string;
	isShort: boolean;
	mounted: boolean;
	onAbort: () => Promise<void>;
	onCommandPanelExpandedChange: (expanded: boolean) => void;
	onSend: (overrideText?: string, context?: SendInteractionContext) => Promise<void>;
	onSelectPendingProject: (name: string) => void;
	onSelectProject: (cwd: string | null) => void;
	onToggleActivity: () => void;
	onTogglePin: () => Promise<void>;
	/** 待创建项目正在落盘：发送按钮与项目选择器都进入准备态。 */
	preparingProject: boolean;
	projectOptions: readonly ProjectOption[];
	projectSelection: ProjectSelection;
	projectTakenNames: readonly string[];
	panelTitle: string;
	pinTitle: string;
	pinned: boolean;
	subtitle: string;
}

export function useNewSessionPageModel(): NewSessionPageModel {
	const { t } = useTranslation(["common", "chat"]);
	const { cwd } = useParams({ strict: false }) as { cwd: string };
	const decodedCwd = decodeURIComponent(cwd);
	// 项目选择器只覆盖页面本地上下文，不切路由：草稿按 `new:${routeCwd}` 隔离，
	// 换项目若走路由就会把用户已经打好的正文换走。
	const projectSelection = useNewSessionProjectSelection(decodedCwd);
	const contextCwd = projectSelection.contextCwd;
	const contextName =
		projectSelection.selection?.name ?? contextCwd.split(/[\\/]/).filter(Boolean).pop() ?? contextCwd;
	const contextLabel =
		projectSelection.selection === null
			? t("chat:newSession.defaultContext")
			: t("chat:newSession.projectContext", { name: contextName });

	// Hero 首帧即挂载（仅用 opacity 入场），避免 idle 延迟插入导致输入栏被顶动。
	const [mounted, setMounted] = useState(false);
	const [avatarAutoplay, setAvatarAutoplay] = useState(false);
	const [commandPanelExpanded, setCommandPanelExpanded] = useState(false);
	const { open: activityOpen, toggle: handleToggleActivity } = useNewSessionActivityPanel(
		projectSelection.activityPanelCwd,
	);
	const [pinned, setPinned] = useState(false);
	const setAttachedImages = useSetAtom(attachedImagesAtom);
	const setHeaderTitle = useSetAtom(pageHeaderTitleAtom);
	const setHeaderTitleBadge = useSetAtom(pageHeaderTitleBadgeAtom);
	const setHeaderTitleHidden = useSetAtom(pageHeaderTitleHiddenAtom);
	const setContextUsage = useSetAtom(contextUsageAtom);
	const setActiveSession = useSetAtom(activeSessionAtom);
	const setPendingSessionCreation = useSetAtom(pendingSessionCreationAtom);
	const setLastActiveSession = useSetAtom(lastActiveSessionAtom);
	const setPromptAttachment = useSetAtom(promptAttachmentAtom);
	const setCurrentScenario = useSetAtom(currentScenarioAtom);
	const setActiveToolNames = useSetAtom(activeToolNamesAtom);
	const authUser = useAtomValue(authUserAtom);
	const executionMode = useAtomValue(sessionExecutionModeAtom);
	const { openSession, sendMessage, abortMessage } = useSessionManager();
	const { createProject } = useProjectActions();
	const setConfirm = useSetAtom(confirmDialogAtom);
	const [preparingProject, setPreparingProject] = useState(false);
	const { selection: currentSelection, applyCreatedProject } = projectSelection;

	// 待创建项目落盘 → 发送，失败则保留输入与选择、只弹错误，不导航。
	const prepareCwd = useCallback(
		(): Promise<string | null> =>
			prepareProjectCwd({
				selection: currentSelection,
				contextCwd,
				createProject,
				onCreated: applyCreatedProject,
				onPreparingChange: setPreparingProject,
				onError: (error) =>
					setConfirm({
						title: i18n.t("chat:newSession.projectSelector.createFailedTitle"),
						message: error instanceof Error ? error.message : String(error),
						confirmLabel: i18n.t("common:actions.close"),
						variant: "danger",
						onConfirm: () => {},
					}),
			}),
		[applyCreatedProject, contextCwd, createProject, currentSelection, setConfirm],
	);

	const newSessionSend = useNewSessionSend({
		cwd: contextCwd,
		executionMode,
		prepareCwd,
		openSession,
		sendMessage,
	});
	const isShort = useShortViewport();
	// 不带过滤词：要的是面板刚展开时那份完整列表的条目数，不能随用户打字过滤而抖。
	// 数据与命令区共用模块级缓存（InputBar 里的 CommandPanel 挂载即预取），命中即立即可用。
	const { items: skillItems } = useSkillList({
		open: commandPanelExpanded,
		cwd: contextCwd,
		filter: "",
		prefetch: true,
	});

	// 进入页面：草稿按 `new:${cwd}` 隔离恢复；其它上下文仍重置，避免串会话。
	useEffect(() => {
		// 先切换草稿作用域（落盘上一会话 → 装入本 cwd 新会话草稿）。
		switchSessionInputDraftScope(newSessionInputDraftKey(decodedCwd));
		// 旧 attachedImages 链路兜底清空（正文 token 已由草稿文本恢复）。
		setAttachedImages([]);
		// 释放一次性的插件 prompt attachment，避免带进新会话。
		setPromptAttachment(null);
		// 清空 input-action / 知识检索工作集，并关掉 hardIsolation contribution mode。
		// 各既有会话的持久化状态仍在 sessionInputActionStateMap，切回可恢复。
		applyInputActionWorkingState(emptySessionInputActionState());
		// 重置输入栏 action 的两道可见性闸门，避免继承上个会话（如批量任务）的隐藏态：
		// 1) 对话场景置为新建普通对话的默认 "conversation"（与 session.create 落库一致），
		//    否则残留 "batch" 会让 fail-closed 过滤把默认 action 全部隐藏。
		// 2) 激活工具集置 null（未知 → 按 scope 默认显示），否则残留批量会话的工具集
		//    不含 generate_image，会让 requiresActiveTool 闸门继续隐藏「图像生成」。
		setCurrentScenario("conversation");
		setActiveToolNames(null);
		// 清掉上一个会话残留的上下文用量，避免 ContextRing 显示旧会话的百分比。
		setContextUsage(null);
		// 清掉 activeSession，避免 InputBar 的 todo 抽屉等仍读取旧会话状态。
		setActiveSession(null);
		setPendingSessionCreation(null);
		// 用户主动进入新会话页后，不应在后续刷新/回到根路由时恢复旧会话。
		setLastActiveSession(null);
	}, [
		decodedCwd,
		setAttachedImages,
		setPromptAttachment,
		setCurrentScenario,
		setActiveToolNames,
		setContextUsage,
		setActiveSession,
		setPendingSessionCreation,
		setLastActiveSession,
	]);

	useEffect(() => {
		setHeaderTitle(t("appShell.routeTitles.chat"));
		setHeaderTitleBadge(contextLabel);
		setHeaderTitleHidden(false);
		return () => {
			setHeaderTitle("");
			setHeaderTitleBadge(null);
			setHeaderTitleHidden(false);
		};
	}, [contextLabel, setHeaderTitle, setHeaderTitleBadge, setHeaderTitleHidden, t]);

	useEffect(() => {
		// decodedCwd 是路由切换的 hero 重播 key；effect body 不需要读取其值。
		void decodedCwd;
		setMounted(false);
		setAvatarAutoplay(false);
		const mountTimer = window.setTimeout(() => {
			startTransition(() => setMounted(true));
		}, 30);
		const autoplayTimer = window.setTimeout(() => {
			startTransition(() => setAvatarAutoplay(true));
		}, 300);
		return () => {
			window.clearTimeout(mountTimer);
			window.clearTimeout(autoplayTimer);
		};
	}, [decodedCwd]);

	useEffect(() => {
		void window.vetta.window.isAlwaysOnTop().then(setPinned);
	}, []);

	const handleTogglePin = useCallback(async () => {
		const next = await window.vetta.window.toggleAlwaysOnTop();
		setPinned(next);
	}, []);

	const greetingTitle = authUser?.nickname
		? i18n.t("chat:newSession.greetingTitle", { nickname: authUser.nickname })
		: i18n.t("chat:newSession.greetingDefault");

	return {
		activityOpen,
		avatarAutoplay,
		commandPanelExpanded,
		commandPanelShift: commandPanelExpanded && skillItems.length > PANEL_SHIFT_MIN_ITEMS,
		cwd: contextCwd,
		activityPanelCwd: projectSelection.activityPanelCwd,
		greetingTitle,
		isShort,
		mounted,
		onAbort: abortMessage,
		onCommandPanelExpandedChange: setCommandPanelExpanded,
		onSelectPendingProject: projectSelection.selectPendingProject,
		onSelectProject: projectSelection.selectProject,
		onSend: newSessionSend.send,
		onToggleActivity: handleToggleActivity,
		onTogglePin: handleTogglePin,
		preparingProject,
		projectOptions: projectSelection.options,
		projectSelection: projectSelection.selection,
		projectTakenNames: projectSelection.takenNames,
		panelTitle: activityOpen ? t("chat:chatView.panelButton.open") : t("chat:chatView.panelButton.closed"),
		pinTitle: pinned ? t("chat:chatView.pinButton.pinned") : t("chat:chatView.pinButton.unpinned"),
		pinned,
		subtitle: i18n.t("chat:newSession.subtitle"),
	};
}
