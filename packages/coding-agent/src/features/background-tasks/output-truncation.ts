const DEFAULT_MAX_LINES = 2_000;
const DEFAULT_MAX_BYTES = 50 * 1_024;

export interface BackgroundTaskOutputTail {
	readonly content: string;
	readonly truncated: boolean;
}

/** Product output budget implemented with platform-neutral UTF-8 primitives. */
export function truncateBackgroundTaskOutputTail(
	content: string,
	options: { readonly maxLines?: number; readonly maxBytes?: number } = {},
): BackgroundTaskOutputTail {
	const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
	const encoder = new TextEncoder();
	const encoded = encoder.encode(content);
	const lines = content.split("\n");
	if (lines.length <= maxLines && encoded.byteLength <= maxBytes) {
		return { content, truncated: false };
	}

	const outputLines: string[] = [];
	let outputBytes = 0;
	for (let index = lines.length - 1; index >= 0 && outputLines.length < maxLines; index -= 1) {
		const line = lines[index];
		const lineBytes = encoder.encode(line);
		const separatorBytes = outputLines.length > 0 ? 1 : 0;
		if (outputBytes + separatorBytes + lineBytes.byteLength > maxBytes) {
			if (outputLines.length === 0) {
				outputLines.unshift(decodeUtf8Tail(lineBytes, maxBytes));
			}
			break;
		}
		outputLines.unshift(line);
		outputBytes += separatorBytes + lineBytes.byteLength;
	}
	return { content: outputLines.join("\n"), truncated: true };
}

function decodeUtf8Tail(bytes: Uint8Array, maxBytes: number): string {
	let start = Math.max(0, bytes.byteLength - maxBytes);
	while (start < bytes.byteLength && (bytes[start] & 0xc0) === 0x80) start += 1;
	return new TextDecoder().decode(bytes.subarray(start));
}
