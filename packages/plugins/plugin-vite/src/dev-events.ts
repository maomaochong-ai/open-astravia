export type VettaPluginDevEvent =
	| {
			type: "ready";
			pluginId: string;
			entryUrl: string;
			origin: string;
		}
	| {
			type: "update";
			pluginId: string;
			reason: "entry" | "full-reload" | "resource";
			path?: string;
		}
	| {
			type: "error";
			pluginId?: string;
			message: string;
		};

type VettaPluginDevEventListener = (event: VettaPluginDevEvent) => void;

let listener: VettaPluginDevEventListener | undefined;

export function setVettaPluginDevEventListener(nextListener: VettaPluginDevEventListener | undefined): void {
	listener = nextListener;
}

export function emitVettaPluginDevEvent(event: VettaPluginDevEvent): void {
	listener?.(event);
}
