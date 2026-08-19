import { MultipleSceneReferencesError, prepareInputPrompt } from "@shared/lib/input-tokens";
import { perfSendMark } from "@shared/lib/perf-send";
import {
	appshotAttachmentAtom,
	attachedImagesAtom,
	chatMessagesAtom,
	clearCurrentSessionInputDraft,
	inputValueAtom,
	mentionedFilesAtom,
	persistCurrentSessionInputDraft,
	type StagedSendInput,
	selectedModelAtom,
} from "@shared/store/atoms";
import type { PromptAttachmentRef } from "@vetta/runtime-core";
import { getDefaultStore } from "jotai";
import { isUserImageFile, nextId } from "./chat-service";

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
export function stageNewSessionSend(overrideText: string | undefined, interactionId: string): StagedSendInput | null {
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
	store.set(chatMessagesAtom, [optimisticMessage]);
	perfSendMark("optimistic-append", interactionId);

	return {
		rawText,
		hasOverride,
		attachedImages,
		mentionedFiles,
		appshot,
		selectedModel,
		optimisticMessage,
	};
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
