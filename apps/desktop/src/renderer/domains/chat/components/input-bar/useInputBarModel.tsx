import { pathBasename, toVettaFileUrl } from "@shared/lib/utils";
import type { InputBarContextMenuViewProps } from "@vetta/theme-ui/chat";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ActiveActionCapsule } from "./ActiveActionCapsules";
import type { InputBarDrawerItem, InputBarModel, InputBarProps, InputBarTodoModel } from "./types";
import { useInputBarAttachmentModel } from "./useInputBarAttachmentModel";
import { useInputBarContextMenuModel } from "./useInputBarContextMenuModel";
import { useInputBarState } from "./useInputBarState";
import { useInputBarTriggerModel } from "./useInputBarTriggerModel";
import { useSessionDropZoneModel } from "../../hooks/useSessionDropZoneModel";

/** 组合输入栏各项职责，避免单一 model 同时承担状态、事件、附件和展示映射。 */
export function useInputBarModel(props: InputBarProps): InputBarModel {
	const { t } = useTranslation("chat");
	const state = useInputBarState(props);
	const dropZone = useSessionDropZoneModel(state.effectiveCwd || undefined);
	const trigger = useInputBarTriggerModel({
		activeSession: state.activeSession,
		canSend: state.canSend,
		firstSuggestion: state.firstSuggestion,
		focusInputRequest: state.focusInputRequest,
		hasSession: state.hasSession,
		isEmpty: state.isEmpty,
		isStreaming: state.isStreaming,
		onAbort: props.onAbort,
		onExpandedChange: props.onExpandedChange,
		onSend: props.onSend,
	});
	const imageAttachments = useMemo(
		() => state.imagePaths.map((path, index) => ({ path, name: pathBasename(path), url: toVettaFileUrl(path), label: t("inputBar.capsule.imageBadge", { index: index + 1 }) })),
		[state.imagePaths, t],
	);
	const attachments = useInputBarAttachmentModel({
		activeRuntimeId: state.activeSession?.runtimeId,
		effectiveCwd: state.effectiveCwd,
		hasSession: state.hasSession,
		imageAttachments,
		setAppshotAttachment: state.setAppshotAttachment,
		setFilePreview: state.setFilePreview,
		setInputValue: state.setInputValue,
		setMentionedFiles: state.setMentionedFiles,
		setPendingMessageEdit: state.setPendingMessageEdit,
		setPromptAttachment: state.setPromptAttachment,
	});
	const contextMenuModel = useInputBarContextMenuModel({
		activeRuntimeId: state.activeSession?.runtimeId,
		hasSession: state.hasSession,
	});
	const activeActions = useMemo<ActiveActionCapsule[]>(
		() => [
			...(state.actionBar.knowledge?.active
				? [{ id: "__builtin_knowledge_retrieval__", label: state.actionBar.knowledge.label, icon: <span className="icon-[mdi--book-search-outline] h-3 w-3" />, onToggle: state.actionBar.actions.toggleKnowledge }]
				: []),
			...state.actionBar.items.filter((item) => item.active).map((item) => ({ id: item.id, label: item.label, icon: item.icon, onToggle: () => state.actionBar.actions.toggleItem(item.id) })),
		],
		[state.actionBar],
	);
	const hasCapsules = imageAttachments.length > 0 || Boolean(state.appshotAttachment) || Boolean(state.pendingMessageEdit);
	const drawerItems = useMemo<InputBarDrawerItem[]>(() => {
		const items: InputBarDrawerItem[] = [];
		if (state.sandboxPermission) {
			items.push({ kind: "sandbox-permission", id: "sandbox-permission", label: t("inputBar.drawer.permissionLabel"), desc: t("inputBar.drawer.permissionDesc"), pulsing: true, request: state.sandboxPermission });
		}
		if (state.queueItems.length > 0 && state.activeSession) {
			const runtimeId = state.activeSession.runtimeId;
			items.push({ kind: "queue", id: "queue", label: t("inputBar.drawer.queueLabel"), desc: state.queuePaused ? t("inputBar.drawer.queuePausedDesc", { count: state.queueItems.length }) : t("inputBar.drawer.queueDesc", { count: state.queueItems.length }), pulsing: state.queuePaused, runtimeId, onSendNow: (id) => props.onSendQueued?.(runtimeId, id) });
		}
		return items;
	}, [props.onSendQueued, state.activeSession, state.queueItems.length, state.queuePaused, state.sandboxPermission, t]);
	const todo = useMemo<InputBarTodoModel | null>(() => state.todoItems.length > 0 ? { items: state.todoItems, onOpenPanel: trigger.openTodoPanel } : null, [state.todoItems, trigger.openTodoPanel]);
	const defaultPlaceholders = useMemo(() => {
		const raw = t("inputBar.placeholder.defaults", { returnObjects: true });
		return (Array.isArray(raw) ? raw : []).filter((item): item is string => typeof item === "string" && item.length > 0);
	}, [t]);
	const placeholderModel = useMemo(() => {
		if (!state.hasSession) return { placeholderTexts: [t("inputBar.placeholder.noSession")], placeholderRotating: false };
		if (state.isStreaming) return { placeholderTexts: [t("inputBar.placeholder.thinking")], placeholderRotating: false };
		if (state.placeholderVisible && state.firstSuggestion) return { placeholderTexts: [t("inputBar.placeholder.suggestion", { suggestion: state.firstSuggestion })], placeholderRotating: false };
		return { placeholderTexts: defaultPlaceholders, placeholderRotating: defaultPlaceholders.length > 1 };
	}, [defaultPlaceholders, state.firstSuggestion, state.hasSession, state.isStreaming, state.placeholderVisible, t]);
	const labels = useMemo<InputBarModel["labels"]>(() => ({
		capsule: { removeDefault: t("inputBar.capsule.removeDefault"), removeImage: t("inputBar.capsule.removeImage"), removeTooltip: (path) => t("inputBar.capsule.removeTooltip", { path }), activeGroup: (count) => t("inputBar.capsule.activeGroup", { count }) },
		permission: { deny: t("inputBar.permission.deny"), allow: t("inputBar.permission.allow"), allowSession: t("inputBar.permission.allowSession") },
		toolbar: { skills: t("inputBar.toolbar.skills"), addImage: t("inputBar.toolbar.addImage"), attachFile: t("inputBar.toolbar.attachFile"), queue: t("inputBar.drawer.queueLabel") },
	}), [t]);
	const contextMenu: InputBarContextMenuViewProps | null = contextMenuModel.contextMenu;

	return {
		dropZone,
		isStreaming: state.isStreaming,
		sendPending: props.sendPending,
		pendingQuestion: state.pendingQuestion,
		pendingMcpElicitation: state.pendingMcpElicitation,
		firstSuggestion: state.firstSuggestion,
		imageAttachments,
		activeActions,
		appshotAttachment: state.appshotAttachment,
		hasSession: state.hasSession,
		canSend: state.canSend,
		isEmpty: state.isEmpty,
		showPlaceholder: state.placeholderVisible,
		hasCapsules,
		effectiveCwd: state.effectiveCwd,
		placeholderTexts: placeholderModel.placeholderTexts,
		placeholderRotating: placeholderModel.placeholderRotating,
		isFocused: trigger.isFocused,
		slashOpen: trigger.slashOpen,
		slashVisible: trigger.slashVisible,
		slashFilter: trigger.slashFilter,
		atOpen: trigger.atOpen,
		atFilter: trigger.atFilter,
		drawerItems,
		drawerActiveTab: trigger.drawerActiveTab,
		todo,
		speechInput: state.speechInput,
		hasPromptAttachment: Boolean(state.promptAttachment),
		promptAttachmentIcon: state.promptAttachment?.icon,
		promptAttachmentLabel: state.promptAttachment?.label,
		promptAttachmentLabels: state.promptAttachment?.labels ?? (state.promptAttachment ? [state.promptAttachment.label] : undefined),
		pendingMessageEdit: Boolean(state.pendingMessageEdit),
		pendingEditHint: t("messageList.edit.pendingHint"),
		cancelPendingEditLabel: t("messageList.interrupt.cancel"),
		contextMenu,
		labels,
		actions: {
			setFocused: trigger.setIsFocused,
			setDrawerActiveTab: trigger.setDrawerActiveTab,
			handleEnter: trigger.handleEnter,
			handleTriggerChange: trigger.handleTriggerChange,
			handleContextMenu: contextMenuModel.onContextMenu,
			handleSlashClose: trigger.handleSlashClose,
			handleSlashSelect: trigger.handleSlashSelect,
			handleConnectorSelect: trigger.handleConnectorSelect,
			handleAtClose: trigger.handleAtClose,
			handleAtSelect: trigger.handleAtSelect,
			removeImage: attachments.removeImage,
			openImagePreview: attachments.openImagePreview,
			removePromptAttachment: attachments.removePromptAttachment,
			removeAppshot: attachments.removeAppshot,
			handlePlusClick: trigger.handlePlusClick,
			handleSelectImages: attachments.handleSelectImages,
			handleSelectFiles: attachments.handleSelectFiles,
			handleSend: trigger.handleSend,
			handleAbort: trigger.handleAbort,
			cancelPendingEdit: attachments.cancelPendingEdit,
		},
	};
}
