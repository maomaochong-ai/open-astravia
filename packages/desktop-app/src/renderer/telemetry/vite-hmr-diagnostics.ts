interface ViteHmrUpdateSummary {
	type?: string;
	path?: string;
	acceptedPath?: string;
}

export interface ViteHmrSummary {
	path?: string;
	triggeredBy?: string;
	updates?: ViteHmrUpdateSummary[];
}

export function initializeViteHmrDiagnostics(): void {
	const hot = import.meta.hot;
	if (!hot) return;
	hot.on("vite:beforeUpdate", (payload) => {
		logViteHmr("before-update", summarizeViteHmrPayload(payload));
	});
	hot.on("vite:beforeFullReload", (payload) => {
		logViteHmr("before-full-reload", summarizeViteHmrPayload(payload));
	});
}

export function summarizeViteHmrPayload(payload: unknown): ViteHmrSummary {
	if (!isRecord(payload)) return {};
	const path = readString(payload, "path");
	const triggeredBy = readString(payload, "triggeredBy");
	const updates = Array.isArray(payload.updates)
		? payload.updates.flatMap((update) => {
				if (!isRecord(update)) return [];
				const summary: ViteHmrUpdateSummary = {};
				const type = readString(update, "type");
				const updatePath = readString(update, "path");
				const acceptedPath = readString(update, "acceptedPath");
				if (type) summary.type = type;
				if (updatePath) summary.path = updatePath;
				if (acceptedPath) summary.acceptedPath = acceptedPath;
				return Object.keys(summary).length > 0 ? [summary] : [];
			})
		: undefined;
	return {
		...(path ? { path } : {}),
		...(triggeredBy ? { triggeredBy } : {}),
		...(updates && updates.length > 0 ? { updates } : {}),
	};
}

function logViteHmr(event: string, summary: ViteHmrSummary): void {
	console.info(`[vite-hmr] ${event} ${JSON.stringify(summary)}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function readString(value: Record<string, unknown>, key: string): string | undefined {
	const candidate = value[key];
	return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}
