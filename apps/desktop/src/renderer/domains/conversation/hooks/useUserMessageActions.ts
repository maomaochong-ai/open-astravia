import type { ConversationUserMessageViewModel } from "@shared/conversation";
import { type InputSegment, parseInputSegments, segmentsToText } from "@shared/lib/input-tokens";
import {
	type ActiveSession,
	activeSessionAtom,
	appshotAttachmentAtom,
	confirmDialogAtom,
	inputValueAtom,
	isStreamingAtom,
	mentionedFilesAtom,
	openSessionFnRef,
	pendingMessageEditAtom,
} from "@shared/store/atoms";
import { getDefaultStore, useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { fullHistoryToChat, isUserImageFile } from "../services/chat-service";
import { dispatchConversationFeed } from "../services/conversation-feed-store";
import { getSessionRuntimeWhenReady } from "../services/session-runtime-readiness";
import { cancelStagedPendingSessionSend, restoreStagedPendingSessionSend } from "../services/staged-new-session-send";

const DELETE_CONFIRMATION_SUPPRESSION_MS = 60_000;

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
	const targetHasStopped = (): boolean =>
		store.get(activeSessionAtom)?.runtimeId === runtimeId && !store.get(isStreamingAtom);
	if (targetHasStopped()) return;
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
		if (targetHasStopped()) {
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
	const store = getDefaultStore();
	if (store.get(activeSessionAtom)?.runtimeId === runtimeId) {
		dispatchConversationFeed({ type: "feed.replaced", items: fullHistoryToChat(history) }, store);
	}
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
			// Bind the intent before confirmation; confirmation may outlive the current page.
			const target = getSessionRuntimeWhenReady();
			const run = (): void => {
				void (async () => {
					const session = await target;
					if (!session) return;
					if (isStreaming) {
						if (getDefaultStore().get(activeSessionAtom)?.runtimeId === session.runtimeId) onAbortEdit?.();
						await abortAndWait(session.runtimeId);
					}
					await action(session);
				})().catch((error) => console.error("[UserMessage] history action failed:", error));
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
	const fill = useCallback(
		async (target: Promise<ActiveSession | null>) => {
			let entryId = message.entryId;
			if (!entryId) {
				const staged = cancelStagedPendingSessionSend(message.id);
				if (staged) {
					restoreStagedPendingSessionSend(staged, { overwriteComposer: true });
					return;
				}
				const session = await target;
				if (!session) return;
				const history = await window.vetta.session.getFullHistory(session.runtimeId);
				if (getDefaultStore().get(activeSessionAtom)?.runtimeId !== session.runtimeId) return;
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
		},
		[message],
	);
	const onEdit = useCallback(() => {
		const target = getSessionRuntimeWhenReady();
		const draftKey = getDefaultStore().get(activeSessionAtom)?.sessionPath;
		const start = (): void => {
			if (getDefaultStore().get(activeSessionAtom)?.sessionPath !== draftKey) return;
			void fill(target).catch((error) => console.error("[UserMessage] prepare edit failed:", error));
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
			if (store.get(activeSessionAtom)?.runtimeId === session.runtimeId) {
				store.set(pendingMessageEditAtom, null);
			}
			const { path } = await window.vetta.session.forkSession(session.runtimeId, entryId);
			if (store.get(activeSessionAtom)?.runtimeId !== session.runtimeId) return;
			await openSessionFnRef.current?.(session.cwd, path);
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
		async (suppressForOneMinute: boolean, target: Promise<ActiveSession | null>) => {
			const entryId = message.entryId;
			if (!entryId) return;
			const session = await target;
			if (!session) return;
			if (isStreaming) {
				if (getDefaultStore().get(activeSessionAtom)?.runtimeId === session.runtimeId) onAbortEdit?.();
				await abortAndWait(session.runtimeId);
			}
			await window.vetta.session.deleteMessage(session.runtimeId, entryId);
			if (suppressForOneMinute) {
				deleteConfirmationSuppressedUntil = Date.now() + DELETE_CONFIRMATION_SUPPRESSION_MS;
			}
			if (
				pendingEdit?.entryId === entryId &&
				getDefaultStore().get(activeSessionAtom)?.runtimeId === session.runtimeId
			) {
				getDefaultStore().set(pendingMessageEditAtom, null);
			}
			await reloadChatHistory(session.runtimeId);
		},
		[isStreaming, message.entryId, onAbortEdit, pendingEdit?.entryId],
	);
	const onDelete = useCallback(() => {
		if (!available) return;
		const target = getSessionRuntimeWhenReady();
		const run = (suppress: boolean): void => {
			void perform(suppress, target).catch((error) => console.error("[UserMessage] delete failed:", error));
		};
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
	}, [available, isStreaming, perform, setConfirmDialog, t]);

	return { available, onDelete };
}

export { useUserMessageContextMenu, useUserMessageCopyAction } from "./userMessageMenu";
