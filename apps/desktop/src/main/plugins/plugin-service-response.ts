/** Bound memory while consuming untrusted downloads or local service responses. */
export async function readPluginServiceResponse(response: Response, maxBytes: number): Promise<Buffer> {
	const length = Number(response.headers.get("content-length"));
	if (Number.isFinite(length) && length > maxBytes) {
		await response.body?.cancel();
		throw new Error("Service response is too large");
	}
	if (!response.body) return Buffer.alloc(0);
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			size += chunk.value.byteLength;
			if (size > maxBytes) {
				await reader.cancel();
				throw new Error("Service response is too large");
			}
			chunks.push(chunk.value);
		}
		return Buffer.concat(chunks, size);
	} finally {
		reader.releaseLock();
	}
}
