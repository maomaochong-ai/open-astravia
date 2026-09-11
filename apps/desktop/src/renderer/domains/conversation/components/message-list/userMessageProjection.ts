import type { ConversationUserMessageViewModel } from "@shared/conversation";
import {
	type InputSegment,
	parseInputSegments,
	type SerializedInputToken,
	serializeInputSegments,
	toTokenPath,
} from "@shared/lib/input-tokens";
import { pathBasename, toVettaFileUrl } from "@shared/lib/utils";
import type { FilePreviewItem } from "@shared/store/atoms";
import type { InlineTokenAnnotation } from "@vetta/theme-ui/chat";
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
	readonly inlineTokenAnnotations: readonly InlineTokenAnnotation[];
	readonly memberMentions: NonNullable<ConversationUserMessageViewModel["memberMentions"]>;
	readonly settingsAssistTabId: string;
}

export function projectUserMessage(message: ConversationUserMessageViewModel): UserMessageProjection {
	const parsedUser = parseUserPrefixes(message.text);
	const { segments: parsedSegments, legacyRef } = parseInputSegments(message.text);
	// Newly sent messages carry the exact editor snapshot. Historical messages do
	// not, so they retain the text parser as a backwards-compatible fallback.
	const segments = message.inputSegments
		? [...message.inputSegments]
		: restoreAttachmentKinds(parsedSegments, message.attachments ?? []);
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

	const serialized = serializeInputSegments(bodySegments);
	const displayText = serialized.text;
	const memberMentions = projectMemberMentionOffsets(message.text, displayText, message.memberMentions ?? []);
	const inlineTokenAnnotations = projectInlineTokenAnnotations(serialized.tokens, displayText, memberMentions);
	const inlinePaths = new Set(
		bodySegments.flatMap((segment) =>
			segment.kind === "file" || segment.kind === "image" ? [toTokenPath(segment.path)] : [],
		),
	);
	const attachmentRefs =
		message.attachments ??
		parsedUser.files.map((path) => ({ kind: isUserImageFile(path) ? ("image" as const) : ("file" as const), path }));
	const appshotImage =
		attachmentRefs.find((attachment) => isAppshotPath(attachment.path) && /\.png$/i.test(attachment.path))?.path ??
		null;
	const displayAttachments = attachmentRefs.filter((attachment) => !isAppshotPath(attachment.path));
	const inlineImagePaths = bodySegments.flatMap((segment) => (segment.kind === "image" ? [segment.path] : []));
	const inlineImageKeys = new Set(inlineImagePaths.map(toTokenPath));
	const imageFiles = [
		...inlineImagePaths,
		...displayAttachments.flatMap((attachment) =>
			attachment.kind === "image" && !inlineImageKeys.has(toTokenPath(attachment.path)) ? [attachment.path] : [],
		),
	];
	const imageIndexByPath = new Map(imageFiles.map((path, index) => [toTokenPath(path), index + 1]));
	const fileBadges = displayAttachments.flatMap((attachment) =>
		attachment.kind !== "image" && !inlinePaths.has(toTokenPath(attachment.path)) ? [attachment.path] : [],
	);
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
		inlineTokenAnnotations,
		memberMentions,
		settingsAssistTabId: message.settingsAssistTabId?.trim() ?? "",
	};
}

function restoreAttachmentKinds(
	segments: readonly InputSegment[],
	attachments: NonNullable<ConversationUserMessageViewModel["attachments"]>,
): InputSegment[] {
	const attachmentKinds = new Map(attachments.map((attachment) => [toTokenPath(attachment.path), attachment.kind]));
	return segments.map((segment): InputSegment => {
		if (segment.kind !== "file" && segment.kind !== "image") return segment;
		const kind = attachmentKinds.get(toTokenPath(segment.path));
		if (kind === "image") return { kind: "image", path: segment.path };
		if (kind === "directory") return { kind: "file", path: segment.path, isDirectory: true };
		if (kind === "file") return { kind: "file", path: segment.path };
		return segment;
	});
}

function projectInlineTokenAnnotations(
	tokens: readonly SerializedInputToken[],
	displayText: string,
	memberMentions: NonNullable<ConversationUserMessageViewModel["memberMentions"]>,
): InlineTokenAnnotation[] {
	const annotations = tokens.map((token): InlineTokenAnnotation => {
		const range = { text: displayText.slice(token.start, token.end), start: token.start, end: token.end };
		if ("participantId" in token) {
			return {
				kind: "member",
				participantId: token.participantId,
				handle: token.handle,
				...range,
			};
		}
		if ("name" in token) {
			return { kind: token.kind, name: token.name, ...range };
		}
		return {
			kind: token.kind,
			path: token.path,
			...(token.kind === "file" && token.isDirectory ? { isDirectory: true } : {}),
			...range,
		};
	});
	const occupiedMemberRanges = new Set(
		annotations
			.filter((annotation) => annotation.kind === "member")
			.map((annotation) => `${annotation.start}:${annotation.end}`),
	);
	for (const mention of memberMentions) {
		if (occupiedMemberRanges.has(`${mention.start}:${mention.end}`)) continue;
		const text = displayText.slice(mention.start, mention.end);
		if (text !== `@${mention.handle}`) continue;
		annotations.push({
			kind: "member",
			participantId: mention.participantId,
			handle: mention.handle,
			text,
			start: mention.start,
			end: mention.end,
		});
	}
	return annotations.sort((left, right) => left.start - right.start || left.end - right.end);
}

function projectMemberMentionOffsets(
	sourceText: string,
	displayText: string,
	mentions: NonNullable<ConversationUserMessageViewModel["memberMentions"]>,
): NonNullable<ConversationUserMessageViewModel["memberMentions"]> {
	if (sourceText === displayText) return mentions.map((mention) => ({ ...mention }));
	const projected: NonNullable<ConversationUserMessageViewModel["memberMentions"]> = [];
	let cursor = 0;
	for (const mention of mentions) {
		const token = sourceText.slice(mention.start, mention.end);
		if (token !== `@${mention.handle}`) continue;
		const start = displayText.indexOf(token, cursor);
		if (start === -1) continue;
		projected.push({ ...mention, start, end: start + token.length });
		cursor = start + token.length;
	}
	return projected;
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
