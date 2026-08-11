export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024;
export const GREP_MAX_LINE_LENGTH = 500;

export interface TruncationResult {
	readonly content: string;
	readonly truncated: boolean;
	readonly truncatedBy: "lines" | "bytes" | null;
	readonly totalLines: number;
	readonly totalBytes: number;
	readonly outputLines: number;
	readonly outputBytes: number;
	readonly lastLinePartial: boolean;
	readonly firstLineExceedsLimit: boolean;
	readonly maxLines: number;
	readonly maxBytes: number;
}

export interface TruncationOptions {
	readonly maxLines?: number;
	readonly maxBytes?: number;
}

export function formatSize(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes}B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)}KB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function truncateHead(content: string, options: TruncationOptions = {}): TruncationResult {
	const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
	const totalBytes = Buffer.byteLength(content, "utf-8");
	const lines = content.split("\n");
	const totalLines = lines.length;

	if (totalLines <= maxLines && totalBytes <= maxBytes) {
		return {
			content,
			truncated: false,
			truncatedBy: null,
			totalLines,
			totalBytes,
			outputLines: totalLines,
			outputBytes: totalBytes,
			lastLinePartial: false,
			firstLineExceedsLimit: false,
			maxLines,
			maxBytes,
		};
	}

	const firstLineBytes = Buffer.byteLength(lines[0], "utf-8");
	if (firstLineBytes > maxBytes) {
		return {
			content: "",
			truncated: true,
			truncatedBy: "bytes",
			totalLines,
			totalBytes,
			outputLines: 0,
			outputBytes: 0,
			lastLinePartial: false,
			firstLineExceedsLimit: true,
			maxLines,
			maxBytes,
		};
	}

	const outputLines: string[] = [];
	let outputBytes = 0;
	let truncatedBy: "lines" | "bytes" = "lines";

	for (let index = 0; index < lines.length && index < maxLines; index++) {
		const line = lines[index];
		const lineBytes = Buffer.byteLength(line, "utf-8") + (index > 0 ? 1 : 0);
		if (outputBytes + lineBytes > maxBytes) {
			truncatedBy = "bytes";
			break;
		}
		outputLines.push(line);
		outputBytes += lineBytes;
	}

	if (outputLines.length >= maxLines && outputBytes <= maxBytes) {
		truncatedBy = "lines";
	}

	const outputContent = outputLines.join("\n");
	return {
		content: outputContent,
		truncated: true,
		truncatedBy,
		totalLines,
		totalBytes,
		outputLines: outputLines.length,
		outputBytes: Buffer.byteLength(outputContent, "utf-8"),
		lastLinePartial: false,
		firstLineExceedsLimit: false,
		maxLines,
		maxBytes,
	};
}

export function truncateTail(content: string, options: TruncationOptions = {}): TruncationResult {
	const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
	const totalBytes = Buffer.byteLength(content, "utf-8");
	const lines = content.split("\n");
	const totalLines = lines.length;

	if (totalLines <= maxLines && totalBytes <= maxBytes) {
		return {
			content,
			truncated: false,
			truncatedBy: null,
			totalLines,
			totalBytes,
			outputLines: totalLines,
			outputBytes: totalBytes,
			lastLinePartial: false,
			firstLineExceedsLimit: false,
			maxLines,
			maxBytes,
		};
	}

	const outputLines: string[] = [];
	let outputBytes = 0;
	let truncatedBy: "lines" | "bytes" = "lines";
	let lastLinePartial = false;

	for (let index = lines.length - 1; index >= 0 && outputLines.length < maxLines; index--) {
		const line = lines[index];
		const lineBytes = Buffer.byteLength(line, "utf-8") + (outputLines.length > 0 ? 1 : 0);
		if (outputBytes + lineBytes > maxBytes) {
			truncatedBy = "bytes";
			if (outputLines.length === 0) {
				const truncatedLine = truncateStringToBytesFromEnd(line, maxBytes);
				outputLines.unshift(truncatedLine);
				outputBytes = Buffer.byteLength(truncatedLine, "utf-8");
				lastLinePartial = true;
			}
			break;
		}
		outputLines.unshift(line);
		outputBytes += lineBytes;
	}

	if (outputLines.length >= maxLines && outputBytes <= maxBytes) {
		truncatedBy = "lines";
	}

	const outputContent = outputLines.join("\n");
	return {
		content: outputContent,
		truncated: true,
		truncatedBy,
		totalLines,
		totalBytes,
		outputLines: outputLines.length,
		outputBytes: Buffer.byteLength(outputContent, "utf-8"),
		lastLinePartial,
		firstLineExceedsLimit: false,
		maxLines,
		maxBytes,
	};
}

export function truncateLine(
	line: string,
	maxChars: number = GREP_MAX_LINE_LENGTH,
): { readonly text: string; readonly wasTruncated: boolean } {
	if (line.length <= maxChars) return { text: line, wasTruncated: false };
	return { text: `${line.slice(0, maxChars)}... [truncated]`, wasTruncated: true };
}

function truncateStringToBytesFromEnd(value: string, maxBytes: number): string {
	const buffer = Buffer.from(value, "utf-8");
	if (buffer.length <= maxBytes) return value;

	let start = buffer.length - maxBytes;
	while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) {
		start += 1;
	}
	return buffer.subarray(start).toString("utf-8");
}
