import type {
	AppMonitorInputActionKind,
	AppMonitorInputActionUsage,
	AppMonitorInputAttachmentSource,
	AppMonitorInputFileAttachment,
	AppMonitorInputImageAttachment,
	AppMonitorInputPromptRefUsage,
} from "@preload/api";

export const BUILTIN_KNOWLEDGE_RETRIEVAL_ACTION_ID = "__builtin_knowledge_retrieval__";

interface FileAttachmentInput {
	path?: string;
	name?: string;
	isDirectory: boolean;
	sizeBytes?: number;
}

interface InputContextUsageInput {
	files?: FileAttachmentInput[];
	images?: AppMonitorInputImageAttachment[];
	promptRef?: AppMonitorInputPromptRefUsage;
}

export function recordInputFilesAdded(source: AppMonitorInputAttachmentSource, files: FileAttachmentInput[]): void {
	const sanitized = files.map(toFileAttachment).filter((file) => file !== null);
	if (sanitized.length === 0) return;
	recordEvent({
		type: "input.attachments.added",
		source,
		files: sanitized,
	});
}

export function recordInputImagesAdded(
	source: AppMonitorInputAttachmentSource,
	images: readonly AppMonitorInputImageAttachment[],
): void {
	if (images.length === 0) return;
	recordEvent({ type: "input.attachments.added", source, images: images.map(toImageAttachment) });
}

export function recordInputActionToggled(
	actionKind: AppMonitorInputActionKind,
	actionId: string,
	active: boolean,
): void {
	recordEvent({
		type: "input.action.toggled",
		actionKind,
		actionId,
		active,
	});
}

export function recordInputActionsUsed(actions: AppMonitorInputActionUsage[]): void {
	if (actions.length === 0) return;
	recordEvent({
		type: "input.action.used",
		actions,
	});
}

export function recordInputContextUsed(input: InputContextUsageInput): void {
	const files = input.files?.map(toFileAttachment).filter((file) => file !== null) ?? [];
	const images = input.images?.map(toImageAttachment) ?? [];
	if (files.length === 0 && images.length === 0 && !input.promptRef) return;
	recordEvent({
		type: "input.context.used",
		files,
		images,
		...(input.promptRef ? { promptRef: input.promptRef } : {}),
	});
}

function recordEvent(event: Parameters<typeof window.vetta.appMonitor.recordEvent>[0]): void {
	try {
		window.vetta.appMonitor.recordEvent(event);
	} catch {
		// Monitoring is best-effort and must not affect input behavior.
	}
}

function toFileAttachment(file: FileAttachmentInput): AppMonitorInputFileAttachment | null {
	const extension = getExtension(file.path || file.name || "");
	return {
		extension: extension || "none",
		isDirectory: file.isDirectory,
		...(normalizeOptionalCount(file.sizeBytes) === undefined
			? {}
			: { sizeBytes: normalizeOptionalCount(file.sizeBytes) }),
	};
}

function toImageAttachment(image: AppMonitorInputImageAttachment): AppMonitorInputImageAttachment {
	return {
		format: image.format,
		...(normalizeOptionalCount(image.sizeBytes) === undefined
			? {}
			: { sizeBytes: normalizeOptionalCount(image.sizeBytes) }),
		...(normalizeOptionalCount(image.width) === undefined ? {} : { width: normalizeOptionalCount(image.width) }),
		...(normalizeOptionalCount(image.height) === undefined ? {} : { height: normalizeOptionalCount(image.height) }),
	};
}

function getExtension(pathOrName: string): string {
	const idx = pathOrName.lastIndexOf(".");
	if (idx < 0 || idx === pathOrName.length - 1) return "";
	return pathOrName
		.slice(idx + 1)
		.trim()
		.toLowerCase()
		.slice(0, 64);
}

function normalizeOptionalCount(value: number | undefined): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
	return Math.floor(value);
}
