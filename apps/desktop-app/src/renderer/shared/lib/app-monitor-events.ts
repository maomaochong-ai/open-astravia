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

interface ImageAttachmentInput {
	data?: string;
	file?: File;
	mimeType?: string;
	name?: string;
	sizeBytes?: number;
}

interface InputContextUsageInput {
	files?: FileAttachmentInput[];
	images?: ImageAttachmentInput[];
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

export function recordInputImagesAdded(source: AppMonitorInputAttachmentSource, images: ImageAttachmentInput[]): void {
	if (images.length === 0) return;
	void collectImageAttachments(images)
		.then((sanitized) => {
			if (sanitized.length === 0) return;
			recordEvent({
				type: "input.attachments.added",
				source,
				images: sanitized,
			});
		})
		.catch(() => undefined);
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
	const hasImages = (input.images?.length ?? 0) > 0;
	if (files.length === 0 && !hasImages && !input.promptRef) return;
	void collectImageAttachments(input.images ?? [])
		.then((images) => {
			if (files.length === 0 && images.length === 0 && !input.promptRef) return;
			recordEvent({
				type: "input.context.used",
				files,
				images,
				...(input.promptRef ? { promptRef: input.promptRef } : {}),
			});
		})
		.catch(() => undefined);
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

async function collectImageAttachments(images: ImageAttachmentInput[]): Promise<AppMonitorInputImageAttachment[]> {
	const result: AppMonitorInputImageAttachment[] = [];
	for (const image of images) {
		const sizeBytes = normalizeOptionalCount(image.sizeBytes ?? image.file?.size ?? sizeBytesFromBase64(image.data));
		const dimensions = await readImageDimensions(image).catch(() => undefined);
		result.push({
			format: getImageFormat(image),
			...(sizeBytes === undefined ? {} : { sizeBytes }),
			...(dimensions?.width ? { width: dimensions.width } : {}),
			...(dimensions?.height ? { height: dimensions.height } : {}),
		});
	}
	return result;
}

function readImageDimensions(image: ImageAttachmentInput): Promise<{ width: number; height: number }> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		let objectUrl: string | undefined;
		img.onload = () => {
			if (objectUrl) URL.revokeObjectURL(objectUrl);
			resolve({ width: img.naturalWidth, height: img.naturalHeight });
		};
		img.onerror = () => {
			if (objectUrl) URL.revokeObjectURL(objectUrl);
			reject(new Error("image dimension read failed"));
		};
		if (image.file) {
			objectUrl = URL.createObjectURL(image.file);
			img.src = objectUrl;
			return;
		}
		if (image.data) {
			img.src = `data:${image.mimeType || "image/png"};base64,${image.data}`;
			return;
		}
		reject(new Error("image source missing"));
	});
}

function getImageFormat(image: ImageAttachmentInput): string {
	const mimeFormat = image.mimeType?.split("/")[1]?.toLowerCase();
	if (mimeFormat) return normalizeFormat(mimeFormat);
	const fileMimeFormat = image.file?.type.split("/")[1]?.toLowerCase();
	if (fileMimeFormat) return normalizeFormat(fileMimeFormat);
	return getExtension(image.name || image.file?.name || "") || "unknown";
}

function normalizeFormat(format: string): string {
	if (format === "jpeg") return "jpg";
	if (format === "svg+xml") return "svg";
	return format || "unknown";
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

function sizeBytesFromBase64(data: string | undefined): number | undefined {
	if (!data) return undefined;
	const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
	return Math.floor((data.length * 3) / 4) - padding;
}
