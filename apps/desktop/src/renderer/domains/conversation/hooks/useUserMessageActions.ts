import type { ConversationUserMessageViewModel } from "@shared/conversation";
import { type InputSegment, parseInputSegments, segmentsToText } from "@shared/lib/input-tokens";
import {
	type ActiveSession,
	appshotAttachmentAtom,
	chatMessagesAtom,
	confirmDialogAtom,
	inputValueAtom,
	isStreamingAtom,
	mentionedFilesAtom,
	openSessionFnRef,
	pendingMessageEditAtom,
} from "@shared/store/atoms";
import { getDefaultStore, useAtomValue, useSetAtom } from "jotai";
import { type MouseEvent, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { fullHistoryToChat, isUserImageFile } from "../services/chat-service";
import { getSessionRuntimeWhenReady } from "../services/session-runtime-readiness";
import { cancelStagedPendingSessionSend, restoreStagedPendingSessionSend } from "../services/staged-new-session-send";
import { copyUserMessageToClipboard } from "../services/user-message-clipboard";

const DELETE_CONFIRMATION_SUPPRESSION_MS = 60_000;
const CONTEXT_MENU_WIDTH = 170;
const CONTEXT_MENU_HEIGHT = 112;
const CONTEXT_MENU_VIEWPORT_GAP = 8;

let deleteConfirmationSuppressedUntil = 0;

function matchesPromptRef(segment: InputSegment, ref: { readonly kind: string; readonly name: string }): boolean {
	return (
		(segment.kind === "skill" || segment.kind === "scene") && segment.kind === ref.kind && segment.name === ref.name
	);
}

function fillInputFromUserMessage(message: ConversationUserMessageViewModel): void {
	const store = getDefaultStore();
	const { segments, legacyRef } = parseInputSegments(message.text);
	const ref = message.promptRef ?? legacyRef ?? null;
	const restored: InputSegment[] = [...segments];
	if (
		ref &&
		(ref.kind === "skill" || ref.kind === "scene") &&
		!restored.some((segment) => matchesPromptRef(segment, ref))
	) {
		restored.unshift({ kind: ref.kind, name: ref.name });
	}
	const covered = new Set(
		restored.flatMap((segment) => (segment.kind === "file" || segment.kind === "image" ? [segment.path] : [])),
	);
	for (const attachment of message.attachments ?? []) {
		if (covered.has(attachment.path)) continue;
		covered.add(attachment.path);
		restored.push(
			attachment.kind === "image" || isUserImageFile(attachment.path)
				? { kind: "image", path: attachment.path }
				: {
						kind: "file",
						path: attachment.path,
						isDirectory: attachment.kind === "directory",
					},
		);
	}
	store.set(inputValueAtom, segmentsToText(restored));
	store.set(appshotAttachmentAtom, null);
}

function inputHasDraft(): boolean {
	const store = getDefaultStore();
	return (
		store.get(inputValueAtom).trim().length > 0 ||
		store.get(mentionedFilesAtom).length > 0 ||
		store.get(appshotAttachmentAtom) !== null
	);
}

async function abortAndWait(runtimeId: string): Promise<void> {
	const store = getDefaultStore();
	if (!store.get(isStreamingAtom)) return;
	await new Promise<void>((resolve) => {
		let settled = false;
		let unsubscribe: () => void = () => {};
		const finish = (): void => {
			if (settled) return;
			settled = true;
			unsubscribe();
			clearTimeout(timer);
			resolve();
		};
		const timer = setTimeout(finish, 8000);
		unsubscribe = window.vetta.session.onRunningChanged((payload) => {
			if (payload.sessionId === runtimeId && payload.running === false) finish();
		});
		if (!store.get(isStreamingAtom)) {
			finish();
			return;
		}
		void window.vetta.session.abort(runtimeId).catch((error) => {
			console.error("[UserMessage] abort failed:", error);
		});
	});
}

async function reloadChatHistory(runtimeId: string): Promise<void> {
	const history = await window.vetta.session.getFullHistory(runtimeId);
	getDefaultStore().set(chatMessagesAtom, fullHistoryToChat(history));
}

function useInterruptibleUserMessageAction({
	isStreaming,
	onAbortEdit,
}: {
	readonly isStreaming: boolean;
	readonly onAbortEdit?: () => void;
}) {
	const { t } = useTranslation("chat");
	const setConfirmDialog = useSetAtom(confirmDialogAtom);
	return useCallback(
		(kind: "switch" | "fork", action: (session: ActiveSession) => void | Promise<void>) => {
			const run = (): void => {
				void (async () => {
					const session = await getSessionRuntimeWhenReady();
					if (!session) return;
					if (isStreaming) {
						onAbortEdit?.();
						await abortAndWait(session.runtimeId);
					}
					await action(session);
				})();
			};
			if (!isStreaming) {
				run();
				return;
			}
			setConfirmDialog({
				title: t(kind === "switch" ? "messageList.interrupt.switchTitle" : "messageList.interrupt.forkTitle"),
				message: t(kind === "switch" ? "messageList.interrupt.switchBody" : "messageList.interrupt.forkBody"),
				confirmLabel: t("messageList.interrupt.confirm"),
				cancelLabel: t("messageList.interrupt.cancel"),
				variant: "danger",
				onConfirm: run,
			});
		},
		[isStreaming, onAbortEdit, setConfirmDialog, t],
	);
}

export function useUserMessageEditAction({
	message,
	isLastUserMessage,
	enabled,
}: {
	readonly message: ConversationUserMessageViewModel;
	readonly isLastUserMessage: boolean;
	readonly enabled: boolean;
}) {
	const { t } = useTranslation("chat");
	const pendingEdit = useAtomValue(pendingMessageEditAtom);
	const setConfirmDialog = useSetAtom(confirmDialogAtom);
	const available = enabled && isLastUserMessage;
	const pending = Boolean(
		pendingEdit && isLastUserMessage && (!message.entryId || pendingEdit.entryId === message.entryId),
	);
	const fill = useCallback(async () => {
		let entryId = message.entryId;
		if (!entryId) {
			const staged = cancelStagedPendingSessionSend(message.id);
			if (staged) {
				restoreStagedPendingSessionSend(staged, { overwriteComposer: true });
				return;
			}
			const session = await getSessionRuntimeWhenReady();
			if (!session) return;
			const history = await window.vetta.session.getFullHistory(session.runtimeId);
			for (let index = history.length - 1; index >= 0; index--) {
				const entry = history[index];
				if (entry.type === "message" && entry.message.role === "user" && entry.entryId) {
					entryId = entry.entryId;
					break;
				}
			}
		}
		if (!entryId) return;
		fillInputFromUserMessage(message);
		getDefaultStore().set(pendingMessageEditAtom, { entryId });
	}, [message]);
	const onEdit = useCallback(() => {
		const start = (): void => {
			void fill().catch((error) => console.error("[UserMessage] prepare edit failed:", error));
		};
		if (inputHasDraft() && !pending) {
			setConfirmDialog({
				title: t("messageList.edit.overwriteDraftTitle"),
				message: t("messageList.edit.overwriteDraftBody"),
				confirmLabel: t("messageList.edit.overwriteDraftConfirm"),
				cancelLabel: t("messageList.interrupt.cancel"),
				onConfirm: start,
			});
			return;
		}
		start();
	}, [fill, pending, setConfirmDialog, t]);

	return { available, onEdit, pending };
}

export function useUserMessageHistoryActions({
	message,
	isStreaming,
	onAbortEdit,
	forkEnabled,
}: {
	readonly message: ConversationUserMessageViewModel;
	readonly isStreaming: boolean;
	readonly onAbortEdit?: () => void;
	readonly forkEnabled: boolean;
}) {
	const runInterruptible = useInterruptibleUserMessageAction({ isStreaming, onAbortEdit });
	const branch = message.branch;
	const canSwitch = Boolean(branch && branch.siblings.length > 1 && message.entryId);
	const onSwitch = useCallback(
		(direction: -1 | 1) => {
			if (!branch || !message.entryId) return;
			const targetId = branch.siblings[branch.index + direction];
			if (!targetId || targetId === message.entryId) return;
			getDefaultStore().set(pendingMessageEditAtom, null);
			runInterruptible("switch", async (session) => {
				await window.vetta.session.switchBranch(session.runtimeId, targetId);
				await reloadChatHistory(session.runtimeId);
			});
		},
		[branch, message.entryId, runInterruptible],
	);
	const onFork = useCallback(() => {
		const entryId = message.entryId;
		if (!entryId) return;
		runInterruptible("fork", async (session) => {
			const store = getDefaultStore();
			store.set(pendingMessageEditAtom, null);
			const { path } = await window.vetta.session.forkSession(session.runtimeId, entryId);
			await openSessionFnRef.current?.(session.cwd, path);
			store.set(pendingMessageEditAtom, null);
		});
	}, [message.entryId, runInterruptible]);

	return {
		branchIndex: branch?.index ?? 0,
		branchTotal: branch?.siblings.length ?? 0,
		canSwitch,
		forkAvailable: forkEnabled && Boolean(message.entryId),
		onFork,
		onNext: () => onSwitch(1),
		onPrevious: () => onSwitch(-1),
	};
}

export function useUserMessageDeleteAction({
	message,
	isStreaming,
	onAbortEdit,
	enabled,
}: {
	readonly message: ConversationUserMessageViewModel;
	readonly isStreaming: boolean;
	readonly onAbortEdit?: () => void;
	readonly enabled: boolean;
}) {
	const { t } = useTranslation("chat");
	const pendingEdit = useAtomValue(pendingMessageEditAtom);
	const setConfirmDialog = useSetAtom(confirmDialogAtom);
	const available = enabled && Boolean(message.entryId);
	const perform = useCallback(
		async (suppressForOneMinute: boolean) => {
			const entryId = message.entryId;
			if (!entryId) return;
			const session = await getSessionRuntimeWhenReady();
			if (!session) return;
			if (isStreaming) {
				onAbortEdit?.();
				await abortAndWait(session.runtimeId);
			}
			await window.vetta.session.deleteMessage(session.runtimeId, entryId);
			if (suppressForOneMinute) {
				deleteConfirmationSuppressedUntil = Date.now() + DELETE_CONFIRMATION_SUPPRESSION_MS;
			}
			if (pendingEdit?.entryId === entryId) {
				getDefaultStore().set(pendingMessageEditAtom, null);
			}
			await reloadChatHistory(session.runtimeId);
		},
		[isStreaming, message.entryId, onAbortEdit, pendingEdit?.entryId],
	);
	const run = useCallback(
		(suppress: boolean) => {
			void perform(suppress).catch((error) => console.error("[UserMessage] delete failed:", error));
		},
		[perform],
	);
	const onDelete = useCallback(() => {
		if (!available) return;
		if (Date.now() < deleteConfirmationSuppressedUntil) {
			run(false);
			return;
		}
		setConfirmDialog({
			title: t("messageList.delete.title"),
			message: t(isStreaming ? "messageList.delete.streamingBody" : "messageList.delete.body"),
			confirmLabel: t("messageList.delete.confirm"),
			cancelLabel: t("messageList.interrupt.cancel"),
			checkbox: { label: t("messageList.delete.suppressForOneMinute"), checked: false },
			variant: "danger",
			onConfirm: run,
		});
	}, [available, isStreaming, run, setConfirmDialog, t]);

	return { available, onDelete };
}

export function useUserMessageCopyAction(copyText: string, imageSources: readonly string[]) {
	return useCallback(() => copyUserMessageToClipboard(copyText, imageSources), [copyText, imageSources]);
}

export function useUserMessageContextMenu({
	canCopy,
	canDelete,
	canEdit,
	onCopy,
	onDelete,
	onEdit,
}: {
	readonly canCopy: boolean;
	readonly canDelete: boolean;
	readonly canEdit: boolean;
	readonly onCopy: () => Promise<void>;
	readonly onDelete: () => void;
	readonly onEdit: () => void;
}) {
	const { t } = useTranslation("chat");
	const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
	const close = useCallback(() => setPosition(null), []);
	const onContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
		event.preventDefault();
		setPosition({
			x: Math.max(
				CONTEXT_MENU_VIEWPORT_GAP,
				Math.min(event.clientX, window.innerWidth - CONTEXT_MENU_WIDTH - CONTEXT_MENU_VIEWPORT_GAP),
			),
			y: Math.max(
				CONTEXT_MENU_VIEWPORT_GAP,
				Math.min(event.clientY, window.innerHeight - CONTEXT_MENU_HEIGHT - CONTEXT_MENU_VIEWPORT_GAP),
			),
		});
	}, []);
	return {
		model: position
			? {
					canCopy,
					canDelete,
					canEdit,
					labels: {
						copy: t("messageList.contextMenu.copy"),
						delete: t("messageList.contextMenu.delete"),
						edit: t("messageList.contextMenu.edit"),
					},
					onClose: close,
					onCopy: () => {
						close();
						if (!canCopy) return;
						void onCopy().catch((error) => console.warn("[UserMessage] copy failed", error));
					},
					onDelete: () => {
						close();
						onDelete();
					},
					onEdit: () => {
						close();
						onEdit();
					},
					x: position.x,
					y: position.y,
				}
			: null,
		onContextMenu,
	};
}
