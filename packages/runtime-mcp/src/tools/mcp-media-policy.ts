export const DEFAULT_MCP_MEDIA_MAX_ITEMS = 16;
export const DEFAULT_MCP_MEDIA_MAX_ITEM_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MCP_MEDIA_MAX_TOTAL_BYTES = 24 * 1024 * 1024;

const SAFE_IMAGE_MIME_TYPES = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);
const AUDIO_MIME_TYPE = /^audio\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export interface McpMediaProjectionLimits {
	readonly maxItems?: number;
	readonly maxItemBytes?: number;
	readonly maxTotalBytes?: number;
}

export interface McpMediaCandidate {
	readonly type: "image" | "audio";
	readonly data: string;
	readonly mimeType: string;
}

export interface McpMediaAdmission {
	accept(candidate: McpMediaCandidate): boolean;
}

/** Creates one bounded admission budget for a single untrusted MCP result projection. */
export function createMcpMediaAdmission(limits: McpMediaProjectionLimits = {}): McpMediaAdmission {
	const maxItems = positiveInteger(limits.maxItems, DEFAULT_MCP_MEDIA_MAX_ITEMS);
	const maxItemBytes = positiveInteger(limits.maxItemBytes, DEFAULT_MCP_MEDIA_MAX_ITEM_BYTES);
	const maxTotalBytes = positiveInteger(limits.maxTotalBytes, DEFAULT_MCP_MEDIA_MAX_TOTAL_BYTES);
	let acceptedItems = 0;
	let acceptedBytes = 0;
	return {
		accept(candidate) {
			const bytes = inspectMcpMediaCandidate(candidate);
			if (bytes === undefined || bytes > maxItemBytes) return false;
			if (acceptedItems >= maxItems || acceptedBytes + bytes > maxTotalBytes) return false;
			acceptedItems += 1;
			acceptedBytes += bytes;
			return true;
		},
	};
}

export function selectMcpMediaCandidates<T extends McpMediaCandidate>(
	candidates: readonly T[],
	limits?: McpMediaProjectionLimits,
): T[] {
	const admission = createMcpMediaAdmission(limits);
	return candidates.filter((candidate) => admission.accept(candidate));
}

/** Returns decoded byte length only for canonical base64 and safe browser-renderable MIME types. */
export function inspectMcpMediaCandidate(candidate: McpMediaCandidate): number | undefined {
	const mimeType = candidate.mimeType.trim().toLowerCase();
	if (candidate.type === "image" ? !SAFE_IMAGE_MIME_TYPES.has(mimeType) : !AUDIO_MIME_TYPE.test(mimeType)) {
		return undefined;
	}
	if (candidate.data.length === 0 || candidate.data.length % 4 !== 0 || !BASE64.test(candidate.data)) return undefined;
	const padding = candidate.data.endsWith("==") ? 2 : candidate.data.endsWith("=") ? 1 : 0;
	return (candidate.data.length / 4) * 3 - padding;
}

function positiveInteger(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback;
}
