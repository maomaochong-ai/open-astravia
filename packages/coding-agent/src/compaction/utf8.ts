const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8ByteLength(value: string): number {
	return encoder.encode(value).byteLength;
}

export function sliceUtf8Start(value: string, maxBytes: number): string {
	const bytes = encoder.encode(value);
	if (bytes.length <= maxBytes) return value;
	let end = maxBytes;
	while (end > 0 && isUtf8ContinuationByte(bytes[end])) end -= 1;
	return decoder.decode(bytes.subarray(0, end));
}

export function sliceUtf8End(value: string, maxBytes: number): string {
	const bytes = encoder.encode(value);
	if (bytes.length <= maxBytes) return value;
	let start = bytes.length - maxBytes;
	while (start < bytes.length && isUtf8ContinuationByte(bytes[start])) start += 1;
	return decoder.decode(bytes.subarray(start));
}

function isUtf8ContinuationByte(value: number | undefined): boolean {
	return value !== undefined && (value & 0xc0) === 0x80;
}
