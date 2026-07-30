import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MouseEvent } from "react";
import type { SkillInfo } from "@preload/api";
import {
	activeSessionAtom,
	activityPanelOpenAtom,
	activityPanelTabByProjectAtom,
	appshotAttachmentAtom,
	attachedImagesAtom,
	focusInputRequestAtom,
	getTodoItemsForSession,
	inputValueAtom,
	isStreamingAtom,
	pendingMessageEditAtom,
	pendingQuestionsAtom,
	promptSuggestionsAtom,
	promptAttachmentAtom,
	sandboxPermissionDrawerAtom,
	selectedSkillAtom,
	todoItemsBySessionAtom,
	mentionedFilesAtom,
} from "@shared/store/atoms";
import { getQueueForSession, messageQueueBySessionAtom } from "@shared/store/message-queue-atoms";
import { recordInputFilesAdded } from "@shared/lib/app-monitor-events";
import { isImagePath } from "@shared/lib/input-tokens";
import { pathBasename, toVettaFileUrl } from "@shared/lib/utils";
import { filePreviewAtom } from "@shared/store/file-preview-atoms";
import type { InputBarContextMenuViewProps } from "@vetta/theme-ui/chat";
import type { SelectedFile } from "../AtPanel";
import type { ConnectorGridItem } from "../../hooks/useConnectorGrid";
import {
	focusInputEditor,
	insertConnectorToken,
	insertFileToken,
	insertImageToken,
	insertPlainText,
	insertSkillToken,
	readSelectionText,
	removeImageToken,
	removeSelection,
} from "./editor/inputEditorHandle";
import { persistBase64Images } from "./editor/persistImages";
import {
	inputBlankAtom,
	inputImagePathsAtom,
	inputPlaceholderVisibleAtom,
} from "./editor/tokens/projectionAtoms";
import type { TriggerMatch } from "./editor/tokens/trigger";
import { useInputActionBarModel } from "../useInputActionBarModel";
import type { ActiveActionCapsule } from "./ActiveActionCapsules";
import type { InputBarModel, InputBarProps, InputBarDrawerItem } from "./types";

const CONTEXT_MENU_WIDTH = 160;
const CONTEXT_MENU_HEIGHT = 112;
const CONTEXT_MENU_VIEWPORT_GAP = 8;

interface InputBarContextMenuState {
	canCopy: boolean;
	canCut: boolean;
	canPaste: boolean;
	x: number;
	y: number;
}

function clampContextMenuPosition(clientX: number, clientY: number): { x: number; y: number } {
	return {
		x: Math.max(
			CONTEXT_MENU_VIEWPORT_GAP,
			Math.min(clientX, window.innerWidth - CONTEXT_MENU_WIDTH - CONTEXT_MENU_VIEWPORT_GAP),
		),
		y: Math.max(
			CONTEXT_MENU_VIEWPORT_GAP,
			Math.min(clientY, window.innerHeight - CONTEXT_MENU_HEIGHT - CONTEXT_MENU_VIEWPORT_GAP),
		),
	};
}

async function clipboardHasText(): Promise<boolean> {
	try {
		const text = await navigator.clipboard.readText();
		return text.length > 0;
	} catch {
		// Permission denied or unsupported — still offer paste so user can try.
		return true;
	}
}

async function readFileSize(path: string, isDirectory: boolean): Promise<number | undefined> {
	if (isDirectory) return undefined;
	const stat = await window.vetta.fs.stat(path).catch(() => null);
	return stat && stat.size > 0 ? stat.size : undefined;
}

export function useInputBarModel({
	onSend,
	onAbort,
	onSendQueued,
	cwdOverride,
	onExpandedChange,
}: InputBarProps): InputBarModel {
	const { t } = useTranslation("chat");
	/**
	 * 刻意不订阅 inputValueAtom：它每敲一个字符就换一份新字符串，订阅它等于让
	 * 整条 InputBar（含两个面板与编辑器）逐字符重渲染。这里只要两个布尔投影，
	 * 它们在整段打字过程中最多翻转一次。
	 */
	const isBlank = useAtomValue(inputBlankAtom);
	const placeholderVisible = useAtomValue(inputPlaceholderVisibleAtom);
	const isStreaming = useAtomValue(isStreamingAtom);
	const activeSession = useAtomValue(activeSessionAtom);
	const pendingQuestions = useAtomValue(pendingQuestionsAtom);
	const pendingQuestion = activeSession?.runtimeId ? pendingQuestions[activeSession.runtimeId] : undefined;
	const promptSuggestions = useAtomValue(promptSuggestionsAtom);
	const firstSuggestion = activeSession?.runtimeId ? promptSuggestions[activeSession.runtimeId]?.[0] : undefined;
	const [selectedSkill, setSelectedSkill] = useAtom(selectedSkillAtom);
	const [promptAttachment, setPromptAttachment] = useAtom(promptAttachmentAtom);
	const [appshotAttachment, setAppshotAttachment] = useAtom(appshotAttachmentAtom);
	const [pendingMessageEdit, setPendingMessageEdit] = useAtom(pendingMessageEditAtom);
	const setInputValue = useSetAtom(inputValueAtom);
	const setMentionedFiles = useSetAtom(mentionedFilesAtom);
	const imagePaths = useAtomValue(inputImagePathsAtom);
	const setFilePreview = useSetAtom(filePreviewAtom);
	const focusInputRequest = useAtomValue(focusInputRequestAtom);
	const [isFocused, setIsFocused] = useState(false);
	const [contextMenuState, setContextMenuState] = useState<InputBarContextMenuState | null>(null);
	const [trigger, setTrigger] = useState<TriggerMatch | null>(null);
	const dismissedTriggerRef = useRef<string | null>(null);
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
	const actionBar = useInputActionBarModel();
	const setActivityPanelOpen = useSetAtom(activityPanelOpenAtom);
	const setTabByProject = useSetAtom(activityPanelTabByProjectAtom);
	const [drawerActiveTab, setDrawerActiveTab] = useState<string | null>(null);

	const effectiveCwd = activeSession?.cwd ?? cwdOverride ?? "";
	const hasSession = Boolean(activeSession) || Boolean(cwdOverride);
	// 文件与图片如今都是文本流里的 token，因此文本非空即代表有内容可发。
	const canSend = hasSession && !isStreaming && (!isBlank || Boolean(appshotAttachment));
	const isEmpty = isBlank;
	const showPlaceholder = placeholderVisible;
	/**
	 * 输入卡片上方的图片缩略图行。文本流里只放「图 N」胶囊，
	 * 缩略图集中在上方，编号与胶囊同源（inputImagePathsAtom）。
	 */
	const imageAttachments = useMemo(
		() =>
			imagePaths.map((path, index) => ({
				path,
				name: pathBasename(path),
				url: toVettaFileUrl(path),
				label: t("inputBar.capsule.imageBadge", { index: index + 1 }),
			})),
		[imagePaths, t],
	);

	/**
	 * 已激活的 action 在工具栏里紧跟执行模式（权限/沙箱）右侧显示。
	 * 全量开关列表已搬进命令面板，但激活态是跨消息持续的，面板一关就看不见会让
	 * 用户忘记自己开着知识检索之类的开关。
	 */
	const activeActions = useMemo<ActiveActionCapsule[]>(
		() => [
			...(actionBar.knowledge?.active
				? [
						{
							id: "__builtin_knowledge_retrieval__",
							label: actionBar.knowledge.label,
							icon: <span className="icon-[mdi--book-search-outline] h-3 w-3" />,
							onToggle: actionBar.actions.toggleKnowledge,
						},
					]
				: []),
			...actionBar.items
				.filter((item) => item.active)
				.map((item) => ({
					id: item.id,
					label: item.label,
					icon: item.icon,
					onToggle: () => actionBar.actions.toggleItem(item.id),
				})),
		],
		[actionBar],
	);

	/** 仍留在输入卡片顶部的非行内附件：图片、场景、Appshot、插件上下文、重编辑提示。 */
	const hasCapsules =
		imageAttachments.length > 0 ||
		Boolean(selectedSkill) ||
		Boolean(promptAttachment) ||
		Boolean(appshotAttachment) ||
		Boolean(pendingMessageEdit);

	const slashOpen = trigger?.kind === "slash" && dismissedTriggerRef.current !== `/${trigger.query}`;
	const atOpen = trigger?.kind === "at" && dismissedTriggerRef.current !== `@${trigger.query}`;
	const slashFilter = trigger?.kind === "slash" ? `/${trigger.query}` : "";
	const atFilter = trigger?.kind === "at" ? `@${trigger.query}` : "";

	useEffect(() => {
		onExpandedChange?.(slashOpen);
	}, [onExpandedChange, slashOpen]);

	useEffect(() => {
		if (sandboxPermission) setDrawerActiveTab("sandbox-permission");
	}, [sandboxPermission]);

	useEffect(() => {
		if (hasSession && !isStreaming) focusInputEditor();
	}, [hasSession, isStreaming]);

	useEffect(() => {
		if (focusInputRequest > 0) focusInputEditor();
	}, [focusInputRequest]);

	const handleSend = useCallback(() => {
		void onSend();
	}, [onSend]);

	const handleAbort = useCallback(() => {
		void onAbort();
	}, [onAbort]);

	/** 回车：能发就发，生成中则入队，空输入时用输入预测直发。返回是否已处理。 */
	const handleEnter = useCallback((): boolean => {
		if (canSend) {
			void onSend();
			return true;
		}
		if (isStreaming && hasSession && !isEmpty) {
			void onSend();
			return true;
		}
		if (hasSession && !isStreaming && isEmpty && firstSuggestion) {
			void onSend(firstSuggestion);
			return true;
		}
		return false;
	}, [canSend, firstSuggestion, hasSession, isEmpty, isStreaming, onSend]);

	const handleTriggerChange = useCallback((next: TriggerMatch | null) => {
		setTrigger(next);
		// 触发词一变（继续打字或离开）就复位「已手动关闭」的记忆。
		const key = next ? `${next.kind === "slash" ? "/" : "@"}${next.query}` : null;
		if (dismissedTriggerRef.current !== null && dismissedTriggerRef.current !== key) {
			dismissedTriggerRef.current = null;
		}
	}, []);

	const dismissTrigger = useCallback(() => {
		if (!trigger) return;
		dismissedTriggerRef.current = `${trigger.kind === "slash" ? "/" : "@"}${trigger.query}`;
		setTrigger(null);
	}, [trigger]);

	const handleSlashSelect = useCallback(
		(skill: SkillInfo, icon?: string) => {
			if (skill.type === "scene") {
				// 场景仍走 PromptRequest.promptRef 硬展开（tasks.json 自动建 todo + 锁列表），
				// 因此它不进文本流，只在输入卡片顶部保留一枚胶囊，且同时只能有一个。
				setSelectedSkill({ name: skill.name, alias: skill.alias, type: skill.type });
			} else {
				insertSkillToken(skill.name, skill.alias, icon, { replaceTrigger: true });
			}
			setTrigger(null);
			focusInputEditor();
		},
		[setSelectedSkill],
	);

	const handleConnectorSelect = useCallback((connector: ConnectorGridItem) => {
		// 与 skill 同为软引用：只把「用哪个连接器」写进文本，不做工具门控。
		insertConnectorToken(connector.name, connector.label, connector.iconUrl, { replaceTrigger: true });
		setTrigger(null);
		focusInputEditor();
	}, []);

	const handleRemoveSkill = useCallback(() => {
		setSelectedSkill(null);
		focusInputEditor();
	}, [setSelectedSkill]);

	const handleAtSelect = useCallback(
		async (file: SelectedFile) => {
			if (isImagePath(file.path)) {
				insertImageToken(file.path, { replaceTrigger: true });
			} else {
				insertFileToken(file.path, file.isDirectory, { replaceTrigger: true });
			}
			setTrigger(null);
			const sizeBytes = await readFileSize(file.path, file.isDirectory);
			recordInputFilesAdded("at-panel", [
				{
					path: file.path,
					name: file.name,
					isDirectory: file.isDirectory,
					...(sizeBytes === undefined ? {} : { sizeBytes }),
				},
			]);
			focusInputEditor();
		},
		[],
	);

	const handlePlusClick = useCallback(() => {
		if (!hasSession) return;
		// 无触发词时点「+」直接开面板；已开则关掉。
		setTrigger((prev) => (prev?.kind === "slash" ? null : { kind: "slash", query: "", length: 0 }));
		dismissedTriggerRef.current = null;
	}, [hasSession]);

	const handleTodoViewMore = useCallback(() => {
		const cwd = activeSession?.cwd;
		if (!cwd) return;
		setDrawerActiveTab(null);
		setActivityPanelOpen(true);
		setTabByProject((prev) => {
			const map = new Map(prev);
			map.set(cwd, "todo");
			return map;
		});
	}, [activeSession?.cwd, setActivityPanelOpen, setTabByProject]);

	const drawerItems = useMemo((): InputBarDrawerItem[] => {
		const items: InputBarDrawerItem[] = [];
		if (sandboxPermission) {
			items.push({
				kind: "sandbox-permission",
				id: "sandbox-permission",
				label: t("inputBar.drawer.permissionLabel"),
				desc: t("inputBar.drawer.permissionDesc"),
				pulsing: true,
				request: sandboxPermission,
			});
		}
		if (queueItems.length > 0 && activeSession) {
			const runtimeId = activeSession.runtimeId;
			items.push({
				kind: "queue",
				id: "queue",
				label: t("inputBar.drawer.queueLabel"),
				desc: t("inputBar.drawer.queueDesc", { count: queueItems.length }),
				runtimeId,
				onSendNow: (id) => onSendQueued?.(runtimeId, id),
			});
		}
		if (todoItems.length === 0) return items;
		const inProgressItem = todoItems.find((i) => i.status === "in_progress");
		const doneCount = todoItems.filter((i) => i.status === "done").length;
		items.push({
			kind: "todo",
			id: "todo",
			label: t("inputBar.drawer.todoLabel"),
			desc: inProgressItem
				? t("inputBar.drawer.todoDesc", {
						done: doneCount,
						total: todoItems.length,
						content: inProgressItem.content,
					})
				: t("inputBar.drawer.todoDescSimple", { done: doneCount, total: todoItems.length }),
			pulsing: !!inProgressItem,
			items: todoItems,
			onViewMore: handleTodoViewMore,
		});
		return items;
	}, [activeSession, handleTodoViewMore, onSendQueued, queueItems.length, sandboxPermission, t, todoItems]);

	const handleSelectImages = useCallback(async () => {
		if (!hasSession) return;
		const selected = await window.vetta.dialog.selectImages();
		const paths = await persistBase64Images(selected, activeSession?.runtimeId ?? null, "image-dialog");
		for (const path of paths) insertImageToken(path);
		focusInputEditor();
	}, [activeSession?.runtimeId, hasSession]);

	const handleSelectFiles = useCallback(async () => {
		if (!hasSession) return;
		const paths = await window.vetta.dialog.selectFiles(effectiveCwd || undefined);
		const additions = [];
		for (const path of paths) {
			if (isImagePath(path)) insertImageToken(path);
			else insertFileToken(path, false);
			const sizeBytes = await readFileSize(path, false);
			additions.push({
				path,
				name: pathBasename(path),
				isDirectory: false,
				...(sizeBytes === undefined ? {} : { sizeBytes }),
			});
		}
		if (additions.length > 0) recordInputFilesAdded("file-dialog", additions);
		focusInputEditor();
	}, [effectiveCwd, hasSession]);

	const openImagePreview = useCallback(
		(index: number) => {
			setFilePreview({
				items: imageAttachments.map((item) => ({ name: item.name, path: item.path, url: item.url })),
				index,
			});
		},
		[imageAttachments, setFilePreview],
	);

	const removeImage = useCallback((path: string) => {
		removeImageToken(path);
		focusInputEditor();
	}, []);

	const closeContextMenu = useCallback(() => setContextMenuState(null), []);

	const handleContextMenu = useCallback(
		(e: MouseEvent<HTMLDivElement>): void => {
			e.preventDefault();
			if (!hasSession) return;
			const hasSelection = readSelectionText().length > 0;
			const position = clampContextMenuPosition(e.clientX, e.clientY);
			void clipboardHasText().then((hasClipboard) => {
				setContextMenuState({
					...position,
					canCopy: hasSelection,
					canCut: hasSelection,
					canPaste: hasClipboard,
				});
			});
		},
		[hasSession],
	);

	const handleMenuCopy = useCallback(() => {
		closeContextMenu();
		const selected = readSelectionText();
		if (!selected) return;
		void navigator.clipboard.writeText(selected).catch((error) => {
			console.warn("[useInputBarModel] copy clipboard write failed", error);
		});
	}, [closeContextMenu]);

	const handleMenuCut = useCallback(() => {
		closeContextMenu();
		const selected = readSelectionText();
		if (!selected) return;
		void navigator.clipboard.writeText(selected).catch((error) => {
			console.warn("[useInputBarModel] cut clipboard write failed", error);
		});
		removeSelection();
		focusInputEditor();
	}, [closeContextMenu]);

	const handleMenuPaste = useCallback(() => {
		closeContextMenu();
		if (!hasSession) return;
		void (async () => {
			let clip = "";
			try {
				clip = await navigator.clipboard.readText();
			} catch (error) {
				console.warn("[useInputBarModel] paste clipboard read failed", error);
				return;
			}
			if (!clip) return;
			insertPlainText(clip);
			focusInputEditor();
		})();
	}, [closeContextMenu, hasSession]);

	const removePromptAttachment = useCallback(() => {
		setPromptAttachment(null);
	}, [setPromptAttachment]);

	const removeAppshot = useCallback(() => {
		setAppshotAttachment(null);
	}, [setAppshotAttachment]);

	const cancelPendingEdit = useCallback(() => {
		setPendingMessageEdit(null);
		// 清空文本 → ValueBridgePlugin 会把编辑器一并清干净（含所有行内 token）。
		setInputValue("");
		setSelectedSkill(null);
		setMentionedFiles([]);
		setAppshotAttachment(null);
	}, [setAppshotAttachment, setInputValue, setMentionedFiles, setPendingMessageEdit, setSelectedSkill]);

	const defaultPlaceholders = useMemo(() => {
		const raw = t("inputBar.placeholder.defaults", { returnObjects: true });
		const list = Array.isArray(raw) ? (raw as string[]) : [];
		return list.filter((item) => typeof item === "string" && item.length > 0);
	}, [t]);

	const { placeholderTexts, placeholderRotating } = useMemo(() => {
		if (!hasSession) {
			return {
				placeholderTexts: [t("inputBar.placeholder.noSession")] as const,
				placeholderRotating: false,
			};
		}
		if (isStreaming) {
			return {
				placeholderTexts: [t("inputBar.placeholder.thinking")] as const,
				placeholderRotating: false,
			};
		}
		if (showPlaceholder && firstSuggestion) {
			return {
				placeholderTexts: [
					t("inputBar.placeholder.suggestion", { suggestion: firstSuggestion }),
				] as const,
				placeholderRotating: false,
			};
		}
		return {
			placeholderTexts: defaultPlaceholders,
			placeholderRotating: defaultPlaceholders.length > 1,
		};
	}, [hasSession, isStreaming, showPlaceholder, firstSuggestion, defaultPlaceholders, t]);

	const labels = useMemo<InputBarModel["labels"]>(
		() => ({
			capsule: {
				removeDefault: t("inputBar.capsule.removeDefault"),
				removeImage: t("inputBar.capsule.removeImage"),
				removeTooltip: (path) => t("inputBar.capsule.removeTooltip", { path }),
				activeGroup: (count) => t("inputBar.capsule.activeGroup", { count }),
			},
			permission: {
				deny: t("inputBar.permission.deny"),
				allow: t("inputBar.permission.allow"),
				allowSession: t("inputBar.permission.allowSession"),
			},
			toolbar: {
				skills: t("inputBar.toolbar.skills"),
				addImage: t("inputBar.toolbar.addImage"),
				attachFile: t("inputBar.toolbar.attachFile"),
				queue: t("inputBar.drawer.queueLabel"),
			},
		}),
		[t],
	);

	const contextMenu: InputBarContextMenuViewProps | null = contextMenuState
		? {
				canCopy: contextMenuState.canCopy,
				canCut: contextMenuState.canCut,
				canPaste: contextMenuState.canPaste,
				labels: {
					copy: t("inputBar.contextMenu.copy"),
					cut: t("inputBar.contextMenu.cut"),
					paste: t("inputBar.contextMenu.paste"),
				},
				onClose: closeContextMenu,
				onCopy: handleMenuCopy,
				onCut: handleMenuCut,
				onPaste: handleMenuPaste,
				x: contextMenuState.x,
				y: contextMenuState.y,
			}
		: null;

	return {
		isStreaming,
		pendingQuestion,
		firstSuggestion,
		imageAttachments,
		activeActions,
		selectedSkill,
		appshotAttachment,
		hasSession,
		canSend,
		isEmpty,
		showPlaceholder,
		hasCapsules,
		effectiveCwd,
		placeholderTexts,
		placeholderRotating,
		isFocused,
		slashOpen,
		slashFilter,
		atOpen,
		atFilter,
		drawerItems,
		drawerActiveTab,
		hasPromptAttachment: Boolean(promptAttachment),
		promptAttachmentIcon: promptAttachment?.icon,
		promptAttachmentLabel: promptAttachment?.label,
		pendingMessageEdit: Boolean(pendingMessageEdit),
		pendingEditHint: t("messageList.edit.pendingHint"),
		cancelPendingEditLabel: t("messageList.interrupt.cancel"),
		contextMenu,
		labels,
		actions: {
			setFocused: setIsFocused,
			setDrawerActiveTab,
			handleEnter,
			handleTriggerChange,
			handleContextMenu,
			handleSlashClose: dismissTrigger,
			handleSlashSelect,
			handleConnectorSelect,
			handleAtClose: dismissTrigger,
			handleAtSelect,
			removeSkill: handleRemoveSkill,
			removeImage,
			openImagePreview,
			removePromptAttachment,
			removeAppshot,
			handlePlusClick,
			handleSelectImages,
			handleSelectFiles,
			handleSend,
			handleAbort,
			cancelPendingEdit,
		},
	};
}
