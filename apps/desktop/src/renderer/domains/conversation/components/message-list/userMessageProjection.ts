import type { ConversationUserMessageViewModel } from "@shared/conversation";
import { type InputSegment, parseInputSegments, segmentsToText, toTokenPath } from "@shared/lib/input-tokens";
import { pathBasename, toVettaFileUrl } from "@shared/lib/utils";
import type { FilePreviewItem } from "@shared/store/atoms";
import { isSystemAttachmentPath, isUserImageFile, parseUserPrefixes } from "../../services/chat-service";
import type { AppshotCardData } from "../AppshotCard";

function matchesPromptRef(segment: InputSegment, ref: { readonly kind: string; readonly name: string }): boolean {
	return (
		(segment.kind === "skill" || segment.kind === "scene") && segment.kind === ref.kind && segment.name === ref.name
	);
}

function isAppshotPath(path: string): boolean {
	return /[/\\]image-cache[/\\]appshot[/\\]/.test(path);
}

function splitAppshotFiles(files: string[]): { appshotImage: string | null; rest: string[] } {
	const appshotImage = files.find((path) => isAppshotPath(path) && /\.png$/i.test(path)) ?? null;
	return { appshotImage, rest: files.filter((path) => !isAppshotPath(path)) };
}

export function userMessagePreviewSource(item: FilePreviewItem): string {
	if (item.path) return toVettaFileUrl(item.path);
	return item.url ?? "";
}

export interface UserMessageProjection {
	readonly appshot: AppshotCardData | null;
	readonly copyImageSources: readonly string[];
	readonly copyText: string;
	readonly displayText: string;
	readonly fileBadges: readonly string[];
	readonly imageIndexByPath: ReadonlyMap<string, number>;
	readonly imageItems: readonly FilePreviewItem[];
	readonly settingsAssistTabId: string;
}

export function projectUserMessage(message: ConversationUserMessageViewModel): UserMessageProjection {
	const parsedUser = parseUserPrefixes(message.text);
	const { segments, legacyRef } = parseInputSegments(message.text);
	const promptRef = message.promptRef ?? legacyRef ?? undefined;
	const bodySegments = segments.filter(
		(segment) => (segment.kind !== "image" && segment.kind !== "file") || !isAppshotPath(segment.path),
	);
	if (
		(promptRef?.kind === "skill" || promptRef?.kind === "scene") &&
		!bodySegments.some((segment) => matchesPromptRef(segment, promptRef))
	) {
		bodySegments.unshift({ kind: promptRef.kind, name: promptRef.name });
	}

	const displayText = segmentsToText(bodySegments);
	const inlinePaths = new Set(
		bodySegments.flatMap((segment) =>
			segment.kind === "file" || segment.kind === "image" ? [toTokenPath(segment.path)] : [],
		),
	);
	const attachmentPaths = message.attachments?.map((attachment) => attachment.path) ?? parsedUser.files;
	const { appshotImage, rest: displayFiles } = splitAppshotFiles(attachmentPaths);
	const inlineImagePaths = bodySegments.flatMap((segment) => (segment.kind === "image" ? [segment.path] : []));
	const inlineImageKeys = new Set(inlineImagePaths.map(toTokenPath));
	const imageFiles = [
		...inlineImagePaths,
		...displayFiles.filter((file) => isUserImageFile(file) && !inlineImageKeys.has(toTokenPath(file))),
	];
	const imageIndexByPath = new Map(imageFiles.map((path, index) => [toTokenPath(path), index + 1]));
	const fileBadges = displayFiles.filter((file) => !isUserImageFile(file) && !inlinePaths.has(toTokenPath(file)));
	const appshot = message.appshot ?? (appshotImage ? { imagePath: appshotImage } : null);
	const fromPaths = imageFiles.map((path) => ({
		name: pathBasename(path),
		path,
		kind: "image" as const,
	}));
	const imageItems = imageFiles.some(isSystemAttachmentPath)
		? fromPaths
		: [
				...(message.images ?? []).map((image) => ({
					name: image.name,
					url: `data:${image.mimeType};base64,${image.data}`,
					kind: "image" as const,
					mime: image.mimeType,
				})),
				...fromPaths,
			];
	const copyImageSources = [
		...imageItems.map(userMessagePreviewSource).filter((source) => source.length > 0),
		...(appshot?.imagePath ? [toVettaFileUrl(appshot.imagePath)] : []),
	];

	return {
		appshot,
		copyImageSources,
		copyText: displayText.trim(),
		displayText,
		fileBadges,
		imageIndexByPath,
		imageItems,
		settingsAssistTabId: message.settingsAssistTabId?.trim() ?? "",
	};
}

const SETTINGS_ASSIST_TAB_IDS = [
	"mcp",
	"models",
	"knowledge",
	"knowledgeBase",
	"batchTasks",
	"automation",
	"im",
	"webhook",
	"appearance",
	"pet",
	"environment",
	"shortcuts",
	"agent",
] as const;

export type SettingsAssistTabId = (typeof SETTINGS_ASSIST_TAB_IDS)[number];

export function isSettingsAssistTabId(value: string): value is SettingsAssistTabId {
	return (SETTINGS_ASSIST_TAB_IDS as readonly string[]).includes(value);
}
