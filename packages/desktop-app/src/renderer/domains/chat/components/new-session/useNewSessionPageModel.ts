import { i18n } from "@shared/i18n";
import {
	activeSessionAtom,
	activeToolNamesAtom,
	applyInputActionWorkingState,
	attachedImagesAtom,
	authUserAtom,
	contextUsageAtom,
	currentScenarioAtom,
	defaultConversationCwdAtom,
	emptySessionInputActionState,
	lastActiveSessionAtom,
	newSessionInputDraftKey,
	pageHeaderTitleAtom,
	pageHeaderTitleBadgeAtom,
	pageHeaderTitleHiddenAtom,
	projectsAtom,
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
import { PANEL_SHIFT_MIN_ITEMS } from "./constants";
import { useShortViewport } from "./useShortViewport";

interface NewSessionPageModel {
	avatarAutoplay: boolean;
	/** 命令区（`/` 或「+」展开）是否打开：hero 随之淡出让位。 */
	commandPanelExpanded: boolean;
	/**
	 * 输入栏是否要为命令区下沉。
	 * 条目少时面板长不到会盖住 hero 的高度，那趟位移纯属多余，因此不跟 expanded 一致。
	 */
	commandPanelShift: boolean;
	cwd: string;
	greetingTitle: string;
	isShort: boolean;
	mounted: boolean;
	onAbort: () => Promise<void>;
	onCommandPanelExpandedChange: (expanded: boolean) => void;
	onSend: () => Promise<void>;
	subtitle: string;
}

export function useNewSessionPageModel(): NewSessionPageModel {
	const { t } = useTranslation(["common", "chat"]);
	const { cwd } = useParams({ strict: false }) as { cwd: string };
	const decodedCwd = decodeURIComponent(cwd);
	const defaultConversationCwd = useAtomValue(defaultConversationCwdAtom);
	const projects = useAtomValue(projectsAtom);
	const project = projects.find((candidate) => candidate.cwd === decodedCwd);
	const contextName = project?.name ?? decodedCwd.split(/[\\/]/).filter(Boolean).pop() ?? decodedCwd;
	const contextLabel =
		project?.isDefault || decodedCwd === defaultConversationCwd
			? t("chat:newSession.defaultContext")
			: t("chat:newSession.projectContext", { name: contextName });

	// Hero 首帧即挂载（仅用 opacity 入场），避免 idle 延迟插入导致输入栏被顶动。
	const [mounted, setMounted] = useState(false);
	const [avatarAutoplay, setAvatarAutoplay] = useState(false);
	const [commandPanelExpanded, setCommandPanelExpanded] = useState(false);
	const setAttachedImages = useSetAtom(attachedImagesAtom);
	const setHeaderTitle = useSetAtom(pageHeaderTitleAtom);
	const setHeaderTitleBadge = useSetAtom(pageHeaderTitleBadgeAtom);
	const setHeaderTitleHidden = useSetAtom(pageHeaderTitleHiddenAtom);
	const setContextUsage = useSetAtom(contextUsageAtom);
	const setActiveSession = useSetAtom(activeSessionAtom);
	const setLastActiveSession = useSetAtom(lastActiveSessionAtom);
	const setPromptAttachment = useSetAtom(promptAttachmentAtom);
	const setCurrentScenario = useSetAtom(currentScenarioAtom);
	const setActiveToolNames = useSetAtom(activeToolNamesAtom);
	const authUser = useAtomValue(authUserAtom);
	const executionMode = useAtomValue(sessionExecutionModeAtom);
	const { openSession, sendMessage, abortMessage } = useSessionManager();
	const isShort = useShortViewport();
	// 不带过滤词：要的是面板刚展开时那份完整列表的条目数，不能随用户打字过滤而抖。
	// 数据与命令区共用模块级缓存（InputBar 里的 CommandPanel 挂载即预取），命中即立即可用。
	const { items: skillItems } = useSkillList({
		open: commandPanelExpanded,
		cwd: decodedCwd,
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

	// 发送：先创建/打开会话（openSession 内部会 navigate('/')），再触发 sendMessage。
	// sendMessage 现在从 activeSessionRef 读取 session，因此 await 链可以串起来。
	const handleSend = useCallback(async () => {
		// 欢迎页选中的执行模式（沙盒受限/完全访问）必须随会话创建一起传给后端，
		// 否则 session.create 会落到默认 full-access，再被 getState 回填覆盖。
		await openSession(decodedCwd, undefined, executionMode);
		await sendMessage();
	}, [decodedCwd, executionMode, openSession, sendMessage]);

	const greetingTitle = authUser?.nickname
		? i18n.t("chat:newSession.greetingTitle", { nickname: authUser.nickname })
		: i18n.t("chat:newSession.greetingDefault");

	return {
		avatarAutoplay,
		commandPanelExpanded,
		commandPanelShift: commandPanelExpanded && skillItems.length > PANEL_SHIFT_MIN_ITEMS,
		cwd: decodedCwd,
		greetingTitle,
		isShort,
		mounted,
		onAbort: abortMessage,
		onCommandPanelExpandedChange: setCommandPanelExpanded,
		onSend: handleSend,
		subtitle: i18n.t("chat:newSession.subtitle"),
	};
}
