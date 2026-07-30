import type { SkillInfo } from "@preload/api";
import { i18n } from "@shared/i18n";
import { downloadAbility, fetchAbilityInfo } from "@shared/lib/api";
import {
	activeSessionAtom,
	activeToolNamesAtom,
	applyInputActionWorkingState,
	attachedImagesAtom,
	authTokenAtom,
	authUserAtom,
	contextUsageAtom,
	currentScenarioAtom,
	defaultConversationCwdAtom,
	emptySessionInputActionState,
	inputValueAtom,
	lastActiveSessionAtom,
	mentionedFilesAtom,
	newSessionPageVisibilityAtom,
	pageHeaderTitleAtom,
	pageHeaderTitleBadgeAtom,
	pageHeaderTitleHiddenAtom,
	projectsAtom,
	promptAttachmentAtom,
	selectedSkillAtom,
	sessionExecutionModeAtom,
} from "@shared/store/atoms";
import { useParams } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionManager } from "../../hooks/useSessionManager";
import { focusInputEditor, insertSkillToken } from "../input-bar/editor/inputEditorHandle";
import type { GuidingGroup, SceneActionState, SceneItem, SkillSelection } from "./types";
import { useNewSessionResources } from "./useNewSessionResources";
import { useShortViewport } from "./useShortViewport";

function scheduleIdle(callback: () => void, timeout: number): () => void {
	let cancelled = false;
	const run = () => {
		if (!cancelled) callback();
	};
	if ("requestIdleCallback" in window) {
		const id = window.requestIdleCallback(run, { timeout });
		return () => {
			cancelled = true;
			window.cancelIdleCallback(id);
		};
	}
	const id = globalThis.setTimeout(run, timeout);
	return () => {
		cancelled = true;
		globalThis.clearTimeout(id);
	};
}

interface NewSessionPageModel {
	avatarAutoplay: boolean;
	cwd: string;
	greetingTitle: string;
	guidingGroups: GuidingGroup[];
	isShort: boolean;
	mounted: boolean;
	onAbort: () => Promise<void>;
	onGuidingWord: (word: string) => Promise<void>;
	onSceneClick: (scene: SceneItem) => void;
	onSelectSkill: (skill: SkillInfo) => void;
	onSend: () => Promise<void>;
	/** 资源未就绪且对应区块仍开启时，预留高度避免异步插入抖动。 */
	reserveGuidingWords: boolean;
	reserveSceneSlot: boolean;
	reserveSkillBadges: boolean;
	sceneActions: Record<string, SceneActionState>;
	scenes: SceneItem[];
	selectedSkill: SkillSelection;
	skillBadges: SkillInfo[];
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
	const [selectedSkill, setSelectedSkill] = useAtom(selectedSkillAtom);
	const [sceneActions, setSceneActions] = useState<Record<string, SceneActionState>>({});
	// 记录最近一次安装/启用的 Promise，发送时 await 它，保证落盘先于 session.create。
	const installRef = useRef<Promise<void> | null>(null);
	const setInputValue = useSetAtom(inputValueAtom);
	const setAttachedImages = useSetAtom(attachedImagesAtom);
	const setMentionedFiles = useSetAtom(mentionedFilesAtom);
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
	const token = useAtomValue(authTokenAtom);
	const executionMode = useAtomValue(sessionExecutionModeAtom);
	const pageVisibility = useAtomValue(newSessionPageVisibilityAtom);
	const { openSession, sendMessage, abortMessage } = useSessionManager();
	const isShort = useShortViewport();
	const { guidingGroups, loadResources, resourcesLoaded, scenes, skillBadges } = useNewSessionResources(
		decodedCwd,
		token,
	);

	// 进入页面时清空上下文输入态，避免从别处带过来未发的内容。
	useEffect(() => {
		// decodedCwd 是路由切换的 reset key；effect body 不需要读取其值。
		void decodedCwd;
		setInputValue("");
		setSelectedSkill(null);
		setMentionedFiles([]);
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
		setInputValue,
		setSelectedSkill,
		setMentionedFiles,
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

	useEffect(() => {
		// 首帧先画出固定槽位，再在 idle 时拉资源；数据一次落盘替换占位，避免分批插入。
		return scheduleIdle(() => {
			startTransition(() => {
				void loadResources();
			});
		}, 120);
	}, [loadResources]);

	const setSceneAction = useCallback((name: string, state: SceneActionState) => {
		setSceneActions((prev) => ({ ...prev, [name]: state }));
	}, []);

	// active → 直接 attach；disabled → toggle 启用后 attach；uninstalled → 下载安装后 attach。
	// 安装/启用全程同步：成功落盘 + 刷新本地列表后才 setSelectedSkill。
	const handleSceneClick = useCallback(
		(item: SceneItem) => {
			if (item.state === "active") {
				setSelectedSkill({ name: item.name, alias: item.alias, type: "scene" });
				return;
			}
			if (sceneActions[item.name] === "loading") return;
			const run = (async () => {
				setSceneAction(item.name, "loading");
				try {
					if (item.state === "uninstalled") {
						if (!token) throw new Error("未登录，无法安装场景");
						// SceneItem 不带摘要（类型来自 theme-ui），单独查一次 info 拿 sha256 用于安装前校验
						const [info, buffer] = await Promise.all([
							fetchAbilityInfo(token, "scene", item.name),
							downloadAbility(token, "scene", item.name),
						]);
						await window.vetta.skills.installFromMarket(item.name, buffer, "scene", {
							alias: item.alias,
							marketDescription: item.description,
							version: item.version,
							sha256: info.sha256,
						});
					} else {
						// disabled：已落盘，仅切换启用，无需重新下载。
						await window.vetta.skills.toggle(item.name);
					}
					await loadResources();
					setSelectedSkill({ name: item.name, alias: item.alias, type: "scene" });
					setSceneAction(item.name, "idle");
				} catch (err) {
					console.error("场景安装失败:", err);
					setSceneAction(item.name, "error");
					window.setTimeout(() => setSceneAction(item.name, "idle"), 2200);
				}
			})();
			installRef.current = run;
		},
		[sceneActions, token, loadResources, setSceneAction, setSelectedSkill],
	);

	const handleSelectSkill = useCallback(
		(skill: SkillInfo) => {
			// skill 是软引用：点一下往输入框插一个行内 token（可多个、可删）。
			// scene 仍是「整条消息生效」的硬展开，保持单选切换语义。
			if (skill.type !== "scene") {
				insertSkillToken(skill.name, skill.alias);
				focusInputEditor();
				return;
			}
			const isSelected = selectedSkill?.name === skill.name && selectedSkill?.type === skill.type;
			setSelectedSkill(isSelected ? null : { name: skill.name, alias: skill.alias, type: skill.type });
		},
		[selectedSkill, setSelectedSkill],
	);

	const waitForInstall = useCallback(async () => {
		if (!installRef.current) return;
		try {
			await installRef.current;
		} catch {
			// 安装失败已在点击处处理，这里照常发送（不带场景）。
		}
	}, []);

	// 发送：先创建/打开会话（openSession 内部会 navigate('/')），再触发 sendMessage。
	// sendMessage 现在从 activeSessionRef 读取 session，因此 await 链可以串起来。
	const handleSend = useCallback(async () => {
		// 若有正在进行的场景安装，先 await 其落盘，保证 scene 文件先于 session.create 写入，
		// 否则新 session 扫盘时读不到刚点的场景。
		await waitForInstall();
		// 欢迎页选中的执行模式（沙盒受限/完全访问）必须随会话创建一起传给后端，
		// 否则 session.create 会落到默认 full-access，再被 getState 回填覆盖。
		await openSession(decodedCwd, undefined, executionMode);
		await sendMessage();
	}, [decodedCwd, executionMode, openSession, sendMessage, waitForInstall]);

	// 点击引导词 = 以该文本为 overrideText 立即发起一轮：openSession → sendMessage(word)。
	// 用 override 传值而非先 setInputValue，避开 atom 异步更新导致 sendMessage 读到旧值。
	const handleGuidingWord = useCallback(
		async (word: string) => {
			await waitForInstall();
			await openSession(decodedCwd, undefined, executionMode);
			await sendMessage(word);
		},
		[decodedCwd, executionMode, openSession, sendMessage, waitForInstall],
	);

	const greetingTitle = authUser?.nickname
		? i18n.t("chat:newSession.greetingTitle", { nickname: authUser.nickname })
		: i18n.t("chat:newSession.greetingDefault");

	return {
		avatarAutoplay,
		cwd: decodedCwd,
		greetingTitle,
		// 设置 → 新会话页可隐藏对应区块；隐藏时传空数组，下游 length 判断会跳过渲染。
		guidingGroups: pageVisibility.showGuidingWords ? guidingGroups : [],
		isShort,
		mounted,
		onAbort: abortMessage,
		onGuidingWord: handleGuidingWord,
		onSceneClick: handleSceneClick,
		onSelectSkill: handleSelectSkill,
		onSend: handleSend,
		// 仅对设置中仍开启的区块预留高度；隐藏的区块不占位。
		reserveGuidingWords: !resourcesLoaded && pageVisibility.showGuidingWords,
		reserveSceneSlot: !resourcesLoaded && pageVisibility.showSceneCards,
		reserveSkillBadges: !resourcesLoaded && pageVisibility.showSkillBadges,
		sceneActions,
		scenes: pageVisibility.showSceneCards ? scenes : [],
		selectedSkill,
		skillBadges: pageVisibility.showSkillBadges ? skillBadges : [],
		subtitle: i18n.t("chat:newSession.subtitle"),
	};
}
