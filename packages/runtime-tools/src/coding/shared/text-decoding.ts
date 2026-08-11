export function decodeTextBuffer(buffer: Buffer): string {
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(buffer);
		return buffer.toString("utf-8");
	} catch {
		return new TextDecoder("gb18030").decode(buffer);
	}
}
