/** JSON values accepted by MCP structured content and request state. */
export type McpJsonPrimitive = string | number | boolean | null;
export type McpJsonObject = Record<string, unknown>;
export type McpJsonValue = McpJsonPrimitive | McpJsonObject | McpJsonValue[];

/** `_meta` remains open for negotiated extensions, but reserved keys are validated at their owning boundary. */
export type McpMeta = Record<string, unknown>;

export function isMcpJsonValue(value: unknown, depth = 0): value is McpJsonValue {
	if (depth > 32) return false;
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (Array.isArray(value)) return value.every((item) => isMcpJsonValue(item, depth + 1));
	if (typeof value !== "object") return false;
	return Object.values(value).every((item) => isMcpJsonValue(item, depth + 1));
}
