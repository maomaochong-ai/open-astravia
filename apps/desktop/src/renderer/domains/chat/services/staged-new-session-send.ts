import { MultipleSceneReferencesError, prepareInputPrompt } from "@shared/lib/input-tokens";
import { perfSendMark } from "@shared/lib/perf-send";
import {
	activeInputDraftKeyAtom,
	appshotAttachmentAtom,
	attachedImagesAtom,
	chatMessagesAtom,
	clearCurrentSessionInputDraft,
	inputValueAtom,
	mentionedFilesAtom,
	persistCurrentSessionInputDraft,
	persistSessionInputDraft,
	type StagedSendInput,
	selectedModelAtom,
} from "@shared/store/atoms";
import type { PromptAttachmentRef } from "@vetta/runtime-core";
import { getDefaultStore } from "jotai";
import { isUserImageFile, nextId } from "./chat-service";

const pendingSessionSends = new Map<string, StagedSendInput>();

function modelKeyToParts(key: string | null | undefined): { provider: string; id: string } | undefined {
	if (!key) return undefined;
	const separator = key.indexOf("/");
	if (separator <= 0) return undefined;
	return { provider: key.slice(0, separator), id: key.slice(separator + 1) };
}

/**
 * Captures and renders a new session's first user turn without requiring a
 * runtimeId. The returned snapshot is the only input used by the later dispatch.
 */
function stageSessionSend(
	overrideText: string | undefined,
	interactionId: string,
	messagePlacement: "append" | "replace",
): StagedSendInput | null {
	const store = getDefaultStore();
	const inputValue = store.get(inputValueAtom);
	const attachedImages = store.get(attachedImagesAtom).slice();
	const mentionedFiles = store.get(mentionedFilesAtom).slice();
	const appshot = store.get(appshotAttachmentAtom);
	const selectedModel = store.get(selectedModelAtom);
	const override = typeof overrideText === "string" ? overrideText.trim() : "";
	const hasOverride = override.length > 0;
	if (!hasOverride && !inputValue.trim() && attachedImages.length === 0 && mentionedFiles.length === 0 && !appshot) {
		return null;
	}

	const rawText = hasOverride ? override : inputValue.trim();
	let preparedInput: ReturnType<typeof prepareInputPrompt>;
	try {
		preparedInput = prepareInputPrompt(rawText);
	} catch (error) {
		// Invalid scene combinations stay on the composer with their draft intact.
		if (error instanceof MultipleSceneReferencesError) return null;
		throw error;
	}

	const promptRef =
		!hasOverride && preparedInput.sceneName ? { kind: "scene" as const, name: preparedInput.sceneName } : undefined;
	const attachmentsByPath = new Map<string, PromptAttachmentRef>();
	if (!hasOverride) {
		for (const file of mentionedFiles) {
			attachmentsByPath.set(file.path, {
				kind: file.isDirectory ? "directory" : isUserImageFile(file.path) ? "image" : "file",
				path: file.path,
			});
		}
		if (appshot?.imagePath) attachmentsByPath.set(appshot.imagePath, { kind: "image", path: appshot.imagePath });
		if (appshot?.textPath) attachmentsByPath.set(appshot.textPath, { kind: "file", path: appshot.textPath });
	}

	const optimisticMessage: StagedSendInput["optimisticMessage"] = {
		id: nextId("user"),
		role: "user",
		text: hasOverride ? rawText : preparedInput.text,
		timestamp: Date.now(),
		model: modelKeyToParts(selectedModel),
		promptRef,
		attachments: [...attachmentsByPath.values()],
		mentionedFiles,
	};
	if (attachedImages.length > 0) {
		optimisticMessage.images = attachedImages.map((image) => ({
			data: image.data,
			mimeType: image.mimeType,
			name: image.name,
		}));
	}
	if (appshot) optimisticMessage.appshot = appshot;

	if (!hasOverride) {
		clearCurrentSessionInputDraft();
		store.set(attachedImagesAtom, []);
		store.set(mentionedFilesAtom, []);
	}
	store.set(chatMessagesAtom, (messages) =>
		messagePlacement === "replace" ? [optimisticMessage] : [...messages, optimisticMessage],
	);
	perfSendMark("optimistic-append", interactionId);

	return {
		draftKey: store.get(activeInputDraftKeyAtom),
		rawText,
		hasOverride,
		attachedImages,
		mentionedFiles,
		appshot,
		selectedModel,
		optimisticMessage,
	};
}

export function stageNewSessionSend(overrideText: string | undefined, interactionId: string): StagedSendInput | null {
	return stageSessionSend(overrideText, interactionId, "replace");
}

/** Captures a send accepted while an existing Session Runtime is still restoring. */
export function stagePendingSessionSend(
	overrideText: string | undefined,
	interactionId: string,
): StagedSendInput | null {
	const staged = stageSessionSend(overrideText, interactionId, "append");
	if (staged) pendingSessionSends.set(staged.optimisticMessage.id, staged);
	return staged;
}

/** Claims a deferred send for dispatch. Null means the user already cancelled it. */
export function takeStagedPendingSessionSend(messageId: string): StagedSendInput | null {
	const staged = pendingSessionSends.get(messageId) ?? null;
	pendingSessionSends.delete(messageId);
	return staged;
}

/** Cancels an accepted-but-not-dispatched send so it can be edited immediately. */
export function cancelStagedPendingSessionSend(messageId: string): StagedSendInput | null {
	return takeStagedPendingSessionSend(messageId);
}

/** Restores a staged draft when runtime creation fails before dispatch. */
export function restoreStagedNewSessionSend(staged: StagedSendInput): void {
	const store = getDefaultStore();
	store.set(chatMessagesAtom, []);
	if (staged.hasOverride) return;
	store.set(inputValueAtom, staged.rawText);
	store.set(attachedImagesAtom, staged.attachedImages.slice());
	store.set(mentionedFilesAtom, staged.mentionedFiles.slice());
	store.set(appshotAttachmentAtom, staged.appshot);
	persistCurrentSessionInputDraft();
}

/**
 * Rolls back a deferred send when its target open fails or is superseded.
 * Only restore into an untouched composer; text entered after the accepted send
 * has priority and must never be overwritten by recovery.
 */
export function restoreStagedPendingSessionSend(
	staged: StagedSendInput,
	options?: { overwriteComposer?: boolean },
): void {
	pendingSessionSends.delete(staged.optimisticMessage.id);
	const store = getDefaultStore();
	store.set(chatMessagesAtom, (messages) => messages.filter((message) => message.id !== staged.optimisticMessage.id));
	if (staged.hasOverride || !staged.draftKey) return;
	const activeDraftKey = store.get(activeInputDraftKeyAtom);
	if (activeDraftKey !== staged.draftKey) {
		persistSessionInputDraft(staged.draftKey, { text: staged.rawText, appshot: staged.appshot });
		return;
	}
	const composerUntouched =
		store.get(inputValueAtom).trim().length === 0 &&
		store.get(attachedImagesAtom).length === 0 &&
		store.get(mentionedFilesAtom).length === 0 &&
		store.get(appshotAttachmentAtom) === null;
	if (!composerUntouched && options?.overwriteComposer !== true) return;
	store.set(inputValueAtom, staged.rawText);
	store.set(attachedImagesAtom, staged.attachedImages.slice());
	store.set(mentionedFilesAtom, staged.mentionedFiles.slice());
	store.set(appshotAttachmentAtom, staged.appshot);
	persistCurrentSessionInputDraft();
}
