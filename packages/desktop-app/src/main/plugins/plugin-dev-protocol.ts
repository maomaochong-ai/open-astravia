export type PluginDevServerEvent =
	| { type: "ready"; pluginId: string; entryUrl: string; origin: string }
	| { type: "update"; pluginId: string }
	| { type: "error"; pluginId?: string; message: string };

export interface ParsedPluginDevServerOutput {
	events: PluginDevServerEvent[];
	remainder: string;
}

const LOCAL_PLUGIN_DEV_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function parsePluginDevServerEvent(line: string): PluginDevServerEvent | undefined {
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch {
		return undefined;
	}
	if (value === null || typeof value !== "object" || !("type" in value)) return undefined;
	if (
		value.type === "ready" &&
		"pluginId" in value &&
		typeof value.pluginId === "string" &&
		"entryUrl" in value &&
		typeof value.entryUrl === "string" &&
		"origin" in value &&
		typeof value.origin === "string"
	) {
		return { type: "ready", pluginId: value.pluginId, entryUrl: value.entryUrl, origin: value.origin };
	}
	if (value.type === "update" && "pluginId" in value && typeof value.pluginId === "string") {
		return { type: "update", pluginId: value.pluginId };
	}
	if (value.type === "error" && "message" in value && typeof value.message === "string") {
		return {
			type: "error",
			pluginId: "pluginId" in value && typeof value.pluginId === "string" ? value.pluginId : undefined,
			message: value.message,
		};
	}
	return undefined;
}

export function parsePluginDevServerOutput(previous: string, chunk: string): ParsedPluginDevServerOutput {
	const lines = `${previous}${chunk}`.split(/\r?\n/);
	const remainder = lines.pop() ?? "";
	const events = lines.flatMap((line) => {
		const event = parsePluginDevServerEvent(line.trim());
		return event ? [event] : [];
	});
	return { events, remainder };
}

export function normalizePluginDevServerUrls(entryUrl: string, origin: string): { entryUrl: string; origin: string } {
	const parsedEntry = new URL(entryUrl);
	const parsedOrigin = new URL(origin);
	if (
		parsedEntry.protocol !== "http:" ||
		parsedOrigin.protocol !== "http:" ||
		parsedEntry.origin !== parsedOrigin.origin ||
		!LOCAL_PLUGIN_DEV_HOSTNAMES.has(parsedOrigin.hostname)
	) {
		throw new Error("Plugin dev server must use a local HTTP origin");
	}
	return { entryUrl: parsedEntry.href, origin: parsedOrigin.origin };
}
