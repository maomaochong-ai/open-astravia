import { AI_ERROR_CODES, AIError } from "../../protocol/index.js";

export async function* parseGoogleCloudCodeResponse(response: Response, signal?: AbortSignal): AsyncIterable<unknown> {
	if (!response.body) throw new Error("No response body");
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const abortHandler = () => {
		void reader.cancel().catch(() => {});
	};
	signal?.addEventListener("abort", abortHandler, { once: true });

	try {
		while (true) {
			if (signal?.aborted) throw new Error("Request was aborted");
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const records = buffer.split(/\r?\n\r?\n/);
			buffer = records.pop() ?? "";
			for (const record of records) {
				const value = parseSseRecord(record);
				if (value !== undefined) yield value;
			}
		}
		buffer += decoder.decode();
		if (buffer.trim()) {
			const value = parseSseRecord(buffer);
			if (value !== undefined) yield value;
		}
	} finally {
		signal?.removeEventListener("abort", abortHandler);
	}
}

function parseSseRecord(record: string): unknown {
	const data = record
		.split(/\r?\n/)
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice(5).trimStart())
		.join("\n")
		.trim();
	if (!data || data === "[DONE]") return undefined;
	try {
		return JSON.parse(data) as unknown;
	} catch (cause) {
		throw new AIError(AI_ERROR_CODES.RESPONSE_VALIDATION_FAILED, "Cloud Code Assist SSE JSON is malformed", {
			cause,
			metadata: { payloadType: "Cloud Code Assist SSE event" },
		});
	}
}
