import { isImagePath } from "@shared/lib/input-tokens";
import { pathBasename, toVettaFileUrl } from "@shared/lib/utils";
import { filePreviewAtom } from "@shared/store/file-preview-atoms";
import { useSetAtom } from "jotai";
import { useCallback, useMemo, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { InputBar } from "../../components/InputBar";
import type { InputBarModel } from "../../components/input-bar/types";
import { useInputBarContextMenuModel } from "../../components/input-bar/useInputBarContextMenuModel";
import type { TeamAttachmentViewModel, TeamChatActions, TeamChatViewModel } from "./teamChatModel";

const VETTA_PATH_MIME = "application/vetta-path";

function attachmentFromPath(path: string): TeamAttachmentViewModel {
	return {
		path,
		name: pathBasename(path),
		kind: isImagePath(path) ? "image" : "file",
	};
}

export function TeamComposerConnector({
	model,
	actions,
}: {
	readonly model: TeamChatViewModel;
	readonly actions: TeamChatActions;
}): JSX.Element {
	const { t } = useTranslation("chat");
	const setFilePreview = useSetAtom(filePreviewAtom);
	const [focused, setFocused] = useState(false);
	const [dragKind, setDragKind] = useState<"files" | "internal" | null>(null);
	const isStreaming = model.status === "sending" || model.status === "streaming" || model.status === "cancelling";
	const isEmpty = model.draft.trim().length === 0 && model.attachments.length === 0;
	const contextMenu = useInputBarContextMenuModel({
		activeRuntimeId: model.activeSessionId ?? undefined,
		hasSession: model.editorEnabled,
	});
	const imageAttachments = useMemo(
		() =>
			model.attachments
				.filter((attachment) => attachment.kind === "image")
				.map((attachment, index) => ({
					path: attachment.path,
					name: attachment.name,
					url: toVettaFileUrl(attachment.path),
					label: t("inputBar.capsule.imageBadge", { index: index + 1 }),
				})),
		[model.attachments, t],
	);
	const modelScope = useMemo(
		() => ({
			modelKey: model.modelKey,
			...(model.reasoning ? { reasoning: model.reasoning } : {}),
			onModelSelect: (modelKey: string, defaultReasoning?: string) => {
				void actions.selectModel(modelKey, defaultReasoning);
			},
			onReasoningSelect: (reasoning: string) => {
				void actions.selectReasoning(reasoning);
			},
		}),
		[actions, model.modelKey, model.reasoning],
	);

	const detectDragKind = useCallback((event: DragEvent): "files" | "internal" | null => {
		const types = Array.from(event.dataTransfer.types);
		if (types.includes(VETTA_PATH_MIME)) return "internal";
		if (types.includes("Files")) return "files";
		return null;
	}, []);
	const onDragEnter = useCallback((event: DragEvent<Element>) => {
		const kind = detectDragKind(event);
		if (!kind || !model.editorEnabled) return;
		event.preventDefault();
		event.stopPropagation();
		setDragKind(kind);
	}, [detectDragKind, model.editorEnabled]);
	const onDragOver = useCallback((event: DragEvent<Element>) => {
		if (!detectDragKind(event) || !model.editorEnabled) return;
		event.preventDefault();
		event.stopPropagation();
		event.dataTransfer.dropEffect = "copy";
	}, [detectDragKind, model.editorEnabled]);
	const onDragLeave = useCallback((event: DragEvent<Element>) => {
		event.preventDefault();
		event.stopPropagation();
		const related = event.relatedTarget;
		if (related instanceof Node && event.currentTarget.contains(related)) return;
		setDragKind(null);
	}, []);
	const onDrop = useCallback((event: DragEvent<Element>) => {
		const kind = detectDragKind(event);
		setDragKind(null);
		if (!kind || !model.editorEnabled) return;
		event.preventDefault();
		event.stopPropagation();
		if (kind === "internal") {
			const path = event.dataTransfer.getData(VETTA_PATH_MIME);
			if (path) actions.addAttachments([attachmentFromPath(path)]);
			return;
		}
		const additions = Array.from(event.dataTransfer.files)
			.map((file) => window.vetta.fs.pathForFile(file))
			.filter((path): path is string => Boolean(path))
			.map(attachmentFromPath);
		if (additions.length > 0) actions.addAttachments(additions);
	}, [actions, detectDragKind, model.editorEnabled]);

	const routing = useMemo<InputBarModel["routing"]>(() => {
		const leaderSelected = !model.members.some((member) => member.selected);
		return {
			leaderLabel: model.labels.leaderRoute,
			leaderSelected,
			onSelectLeader: actions.selectLeader,
			participants: model.members.map((member) => ({
				id: member.id,
				name: member.name,
				...(member.avatar ? { avatar: member.avatar } : {}),
				blueprintId: member.blueprintId,
				selected: member.selected,
				status: member.status,
				onSelect: () => actions.toggleMember(member.id),
			})),
		};
	}, [actions, model.labels.leaderRoute, model.members]);

	const inputModel: InputBarModel = {
		dropZone: {
			dragKind,
			enabled: model.editorEnabled,
			labels: {
				releaseToRef: t("dropZone.releaseToRef"),
				internalRef: t("dropZone.internalRef"),
				externalRef: t("dropZone.externalRef"),
			},
			onDragEnter,
			onDragOver,
			onDragLeave,
			onDrop,
		},
		isStreaming,
		pendingQuestion: undefined,
		pendingMcpElicitation: undefined,
		imageAttachments,
		activeActions: [],
		appshotAttachment: null,
		hasSession: model.editorEnabled,
		canSend: model.canSend,
		isEmpty,
		showPlaceholder: model.draft.length === 0,
		hasCapsules: model.attachments.length > 0,
		effectiveCwd: model.workspace?.cwd ?? "",
		placeholderTexts: [model.labels.placeholder],
		placeholderRotating: false,
		isFocused: focused,
		drawerItems: [],
		drawerActiveTab: null,
		todo: null,
		speechInput: null,
		hasPromptAttachment: false,
		pendingMessageEdit: false,
		pendingEditHint: t("messageList.edit.pendingHint"),
		cancelPendingEditLabel: t("messageList.interrupt.cancel"),
		contextMenu: contextMenu.contextMenu,
		editor: {
			namespace: `team-chat:${model.activeSessionId ?? "new"}`,
			value: model.draft,
			history: model.history,
			onValueChange: actions.setDraft,
			persistenceId: model.activeSessionId,
		},
		routing,
		modelSelector: { updateActiveSession: false, scope: modelScope },
		leadingTools: [],
		trailingTools: [],
		sendBehavior: "direct",
		labels: {
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
				addImage: model.labels.attachImage,
				attachFile: model.labels.attachFile,
				queue: t("inputBar.drawer.queueLabel"),
			},
		},
		actions: {
			setFocused,
			setDrawerActiveTab: () => undefined,
			handleEnter: () => {
				if (!model.canSend) return false;
				void actions.send();
				return true;
			},
			handleContextMenu: contextMenu.onContextMenu,
			removeImage: actions.removeAttachment,
			openImagePreview: (index) => setFilePreview({ items: imageAttachments, index }),
			removePromptAttachment: () => undefined,
			removeAppshot: () => undefined,
			handleSelectImages: actions.selectImages,
			handleSelectFiles: actions.selectFiles,
			handleSend: () => {
				void actions.send();
			},
			handleAbort: actions.abort,
			cancelPendingEdit: () => undefined,
		},
	};

	return <InputBar model={inputModel} />;
}
