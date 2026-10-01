export const ASTRAVIA_PLUGIN_DEV_PROTOCOL_VERSION = 1;

export type AstraviaPluginDevEvent =
	| {
			type: "ready";
			protocolVersion: typeof ASTRAVIA_PLUGIN_DEV_PROTOCOL_VERSION;
			pluginId: string;
			entryUrl: string;
			origin: string;
		}
	| {
			type: "update";
			pluginId: string;
			reason: "entry" | "full-reload" | "resource";
			path?: string;
			triggeredBy?: string;
		}
	| {
			type: "error";
			pluginId?: string;
			message: string;
		};

type AstraviaPluginDevEventListener = (event: AstraviaPluginDevEvent) => void;

let listener: AstraviaPluginDevEventListener | undefined;

export function setAstraviaPluginDevEventListener(nextListener: AstraviaPluginDevEventListener | undefined): void {
	listener = nextListener;
}

export function emitAstraviaPluginDevEvent(event: AstraviaPluginDevEvent): void {
	listener?.(event);
}
