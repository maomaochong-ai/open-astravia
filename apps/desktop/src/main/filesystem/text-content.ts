export interface DecodedUtf8Text {
	content: string;
	hasBom: boolean;
}

const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);
const MAX_SUSPICIOUS_CONTROL_CHARACTER_RATIO = 0.01;

function startsWithUtf8Bom(bytes: Uint8Array): boolean {
	return (
		bytes.length >= UTF8_BOM.length &&
		bytes[0] === UTF8_BOM[0] &&
		bytes[1] === UTF8_BOM[1] &&
		bytes[2] === UTF8_BOM[2]
	);
}

/** Strict UTF-8 decoding shared by editable files and content-based preview detection. */
export function decodeUtf8Text(bytes: Uint8Array): DecodedUtf8Text | null {
	const hasBom = startsWithUtf8Bom(bytes);
	const body = hasBom ? bytes.subarray(UTF8_BOM.length) : bytes;
	try {
		return {
			content: new TextDecoder("utf-8", { fatal: true }).decode(body),
			hasBom,
		};
	} catch {
		return null;
	}
}

/** Strictly validates a bounded prefix while allowing one incomplete code point at its end. */
export function decodeUtf8Prefix(bytes: Uint8Array): DecodedUtf8Text | null {
	const hasBom = startsWithUtf8Bom(bytes);
	const body = hasBom ? bytes.subarray(UTF8_BOM.length) : bytes;
	try {
		return {
			content: new TextDecoder("utf-8", { fatal: true }).decode(body, { stream: true }),
			hasBom,
		};
	} catch {
		return null;
	}
}

/**
 * Reject valid UTF-8 that still looks like binary data. Tabs, line endings,
 * form feeds and ANSI escape sequences are normal in source files and logs.
 */
export function isProbablyTextContent(content: string): boolean {
	if (!content) return true;
	let totalCharacters = 0;
	let suspiciousControlCharacters = 0;
	for (const character of content) {
		totalCharacters++;
		const codePoint = character.codePointAt(0) ?? 0;
		if (codePoint === 0) return false;
		const isAllowedControl =
			codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0c || codePoint === 0x0d || codePoint === 0x1b;
		if (!isAllowedControl && (codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f))) {
			suspiciousControlCharacters++;
		}
	}
	return suspiciousControlCharacters / totalCharacters <= MAX_SUSPICIOUS_CONTROL_CHARACTER_RATIO;
}

export function decodeProbableUtf8Text(bytes: Uint8Array): DecodedUtf8Text | null {
	const decoded = decodeUtf8Text(bytes);
	return decoded && isProbablyTextContent(decoded.content) ? decoded : null;
}

export function decodeProbableUtf8Prefix(bytes: Uint8Array): DecodedUtf8Text | null {
	const decoded = decodeUtf8Prefix(bytes);
	return decoded && isProbablyTextContent(decoded.content) ? decoded : null;
}
