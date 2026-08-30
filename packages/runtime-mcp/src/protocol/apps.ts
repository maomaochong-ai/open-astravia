import type { McpJsonObject, McpMeta } from "./json.js";
import type { McpResourceContents, McpTool } from "./types.js";

export const MCP_APPS_EXTENSION_ID = "io.modelcontextprotocol/ui" as const;
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app" as const;
export const MCP_APP_LEGACY_RESOURCE_URI_META_KEY = "ui/resourceUri" as const;
export const VETTA_MCP_APP_ATTACHMENT_META_KEY = "io.vetta/mcpApp" as const;

export const MCP_APP_CLIENT_CAPABILITY = Object.freeze({
	mimeTypes: [MCP_APP_MIME_TYPE],
});

export type McpAppToolVisibility = "model" | "app";

export interface McpAppToolMeta {
	readonly resourceUri?: string;
	readonly visibility?: readonly McpAppToolVisibility[];
}

export interface McpAppResourceCsp {
	readonly connectDomains?: readonly string[];
	readonly resourceDomains?: readonly string[];
	readonly frameDomains?: readonly string[];
	readonly baseUriDomains?: readonly string[];
}

export type McpAppPermission = "camera" | "microphone" | "geolocation" | "clipboardWrite";

export interface McpAppResourceMeta {
	readonly prefersBorder?: boolean;
	readonly csp?: McpAppResourceCsp;
	readonly permissions?: Partial<Record<McpAppPermission, McpJsonObject>>;
}

export interface McpAppResource {
	readonly uri: string;
	readonly mimeType: typeof MCP_APP_MIME_TYPE;
	readonly html: string;
	readonly meta?: McpAppResourceMeta;
}

/** Opaque descriptor safe to persist in Tool details and expose to the Renderer. */
export interface McpAppAttachment {
	readonly id: string;
	readonly resourceUri: string;
	readonly mimeType: typeof MCP_APP_MIME_TYPE;
}

/** Reads current nested metadata and the deprecated flat resource URI key. */
export function readMcpAppToolMeta(meta: unknown): McpAppToolMeta | undefined {
	if (!isRecord(meta)) return undefined;
	const ui = isRecord(meta.ui) ? meta.ui : undefined;
	const legacyResourceUri = meta[MCP_APP_LEGACY_RESOURCE_URI_META_KEY];
	const resourceUri = ui?.resourceUri ?? legacyResourceUri;
	if (resourceUri !== undefined && (typeof resourceUri !== "string" || !resourceUri.startsWith("ui://"))) {
		return undefined;
	}
	const visibility = readVisibility(ui?.visibility);
	if (ui?.visibility !== undefined && visibility === undefined) return undefined;
	if (!ui && resourceUri === undefined) return undefined;
	return {
		...(typeof resourceUri === "string" ? { resourceUri } : {}),
		...(visibility ? { visibility } : {}),
	};
}

/** Backwards-compatible name retained for the initial protocol implementation. */
export const readMcpAppUiMeta = readMcpAppToolMeta;

/** Invalid explicit visibility is fail-closed instead of leaking an app-only Tool to the model. */
export function isMcpAppToolVisibleToModel(tool: Pick<McpTool, "_meta">): boolean {
	return readMcpAppVisibility(tool._meta, "model");
}

/** App visibility is scoped by the caller to the same server connection. */
export function isMcpAppToolVisibleToApp(tool: Pick<McpTool, "_meta">): boolean {
	return readMcpAppVisibility(tool._meta, "app");
}

export function readMcpAppResource(contents: readonly McpResourceContents[], uri: string): McpAppResource | undefined {
	if (!uri.startsWith("ui://")) return undefined;
	const resource = contents.find((candidate) => candidate.uri === uri);
	if (!resource || resource.mimeType !== MCP_APP_MIME_TYPE) return undefined;
	const html = "text" in resource ? resource.text : decodeBase64Utf8(resource.blob);
	if (html === undefined) return undefined;
	const meta = readMcpAppResourceMeta(resource._meta);
	return {
		uri,
		mimeType: MCP_APP_MIME_TYPE,
		html,
		...(meta ? { meta } : {}),
	};
}

export function readMcpAppAttachment(details: unknown): McpAppAttachment | undefined {
	if (!isRecord(details)) return undefined;
	const meta = isRecord(details._meta) ? details._meta : undefined;
	const value = meta?.[VETTA_MCP_APP_ATTACHMENT_META_KEY];
	if (!isRecord(value)) return undefined;
	if (
		typeof value.id !== "string" ||
		typeof value.resourceUri !== "string" ||
		!value.resourceUri.startsWith("ui://") ||
		value.mimeType !== MCP_APP_MIME_TYPE
	)
		return undefined;
	return { id: value.id, resourceUri: value.resourceUri, mimeType: MCP_APP_MIME_TYPE };
}

function readMcpAppVisibility(meta: McpMeta | undefined, visibility: McpAppToolVisibility): boolean {
	if (!isRecord(meta)) return true;
	const ui = isRecord(meta.ui) ? meta.ui : undefined;
	if (ui?.visibility === undefined) return true;
	const parsed = readVisibility(ui.visibility);
	return parsed?.includes(visibility) ?? false;
}

function readMcpAppResourceMeta(meta: McpMeta | undefined): McpAppResourceMeta | undefined {
	if (!isRecord(meta) || !isRecord(meta.ui)) return undefined;
	const ui = meta.ui;
	const csp = readCsp(ui.csp);
	const permissions = readPermissions(ui.permissions);
	const prefersBorder = typeof ui.prefersBorder === "boolean" ? ui.prefersBorder : undefined;
	if (csp === undefined && permissions === undefined && prefersBorder === undefined) return undefined;
	return {
		...(prefersBorder === undefined ? {} : { prefersBorder }),
		...(csp ? { csp } : {}),
		...(permissions ? { permissions } : {}),
	};
}

function readCsp(value: unknown): McpAppResourceCsp | undefined {
	if (!isRecord(value)) return undefined;
	const connectDomains = readStrings(value.connectDomains);
	const resourceDomains = readStrings(value.resourceDomains);
	const frameDomains = readStrings(value.frameDomains);
	const baseUriDomains = readStrings(value.baseUriDomains);
	return {
		...(connectDomains ? { connectDomains } : {}),
		...(resourceDomains ? { resourceDomains } : {}),
		...(frameDomains ? { frameDomains } : {}),
		...(baseUriDomains ? { baseUriDomains } : {}),
	};
}

function readPermissions(value: unknown): McpAppResourceMeta["permissions"] | undefined {
	if (!isRecord(value)) return undefined;
	const permissions: Partial<Record<McpAppPermission, McpJsonObject>> = {};
	for (const key of ["camera", "microphone", "geolocation", "clipboardWrite"] as const) {
		if (isRecord(value[key])) permissions[key] = value[key];
	}
	return Object.keys(permissions).length > 0 ? permissions : undefined;
}

function readVisibility(value: unknown): readonly McpAppToolVisibility[] | undefined {
	if (!Array.isArray(value) || value.length === 0) return undefined;
	if (!value.every((item) => item === "model" || item === "app")) return undefined;
	return [...new Set(value)];
}

function readStrings(value: unknown): readonly string[] | undefined {
	return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function decodeBase64Utf8(value: string): string | undefined {
	try {
		const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return undefined;
	}
}

function isRecord(value: unknown): value is McpJsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
