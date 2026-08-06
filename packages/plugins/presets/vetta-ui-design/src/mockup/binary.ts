/** Byte plumbing between canvas data URLs, zip/pdf builders and the host fs API. */

export function dataUrlToBytes(dataUrl: string): Uint8Array {
	const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
	// Chunked: a multi-megabyte spread would blow the argument limit.
	const CHUNK = 0x8000;
	let binary = "";
	for (let index = 0; index < bytes.length; index += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
	}
	return btoa(binary);
}
