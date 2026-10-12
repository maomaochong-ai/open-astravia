import type { Transport } from "@vetta/ai";
import { readAgentSettingsDocument, updateAgentSettingsDocument } from "./settings-document-store.js";

export function getModelTransport(): Transport {
	return normalizeModelTransport(readAgentSettingsDocument().transport);
}

export function setModelTransport(value: unknown): Transport {
	const transport = normalizeModelTransport(value, true);
	updateAgentSettingsDocument((settings) => {
		settings.transport = transport;
	});
	return transport;
}

export function normalizeModelTransport(value: unknown, strict = false): Transport {
	if (value === "sse" || value === "websocket" || value === "auto") return value;
	if (strict) throw new Error(`Invalid model transport: ${String(value)}`);
	return "sse";
}
