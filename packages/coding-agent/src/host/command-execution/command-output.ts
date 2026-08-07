export function sanitizeBinaryOutput(value: string): string {
	return Array.from(value)
		.filter((character) => {
			const code = character.codePointAt(0);
			if (code === undefined) return false;
			if (code === 0x09 || code === 0x0a || code === 0x0d) return true;
			if (code <= 0x1f) return false;
			return code < 0xfff9 || code > 0xfffb;
		})
		.join("");
}

export function decodeTextBuffer(buffer: Buffer): string {
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(buffer);
		return buffer.toString("utf-8");
	} catch {
		return new TextDecoder("gb18030").decode(buffer);
	}
}
