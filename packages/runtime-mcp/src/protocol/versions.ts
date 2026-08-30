/** MCP protocol eras and deterministic version selection. */

export const MCP_MODERN_PROTOCOL_VERSION = "2026-07-28" as const;
export const MCP_LEGACY_LATEST_PROTOCOL_VERSION = "2025-11-25" as const;
export const MCP_LEGACY_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;

export const MCP_LATEST_PROTOCOL_VERSION = MCP_MODERN_PROTOCOL_VERSION;
/** Runtime default until protocol-era negotiation selects the modern transport. */
export const MCP_DEFAULT_PROTOCOL_VERSION = MCP_LEGACY_LATEST_PROTOCOL_VERSION;
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = [MCP_MODERN_PROTOCOL_VERSION, ...MCP_LEGACY_PROTOCOL_VERSIONS] as const;

export type McpProtocolVersion = (typeof MCP_SUPPORTED_PROTOCOL_VERSIONS)[number];
export type McpProtocolEra = "legacy" | "modern";
export type McpProtocolMode = "legacy" | "modern" | "auto";

export interface McpProtocolSelection {
	readonly requestedVersion?: string;
	readonly selectedVersion: McpProtocolVersion;
	readonly era: McpProtocolEra;
	readonly fallback: boolean;
}

export function getMcpProtocolEra(version: string): McpProtocolEra {
	return version === MCP_MODERN_PROTOCOL_VERSION ? "modern" : "legacy";
}

export function isMcpProtocolVersion(value: string): value is McpProtocolVersion {
	return (MCP_SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(value);
}

/** Select an explicit version while keeping old servers on the legacy wire contract. */
export function selectMcpProtocolVersion(requestedVersion?: string): McpProtocolSelection {
	if (requestedVersion === MCP_MODERN_PROTOCOL_VERSION) {
		return {
			requestedVersion,
			selectedVersion: MCP_MODERN_PROTOCOL_VERSION,
			era: "modern",
			fallback: false,
		};
	}

	const candidate = requestedVersion;
	const selectedVersion =
		candidate !== undefined && isMcpProtocolVersion(candidate) && candidate !== MCP_MODERN_PROTOCOL_VERSION
			? candidate
			: MCP_LEGACY_LATEST_PROTOCOL_VERSION;
	return {
		requestedVersion,
		selectedVersion,
		era: "legacy",
		fallback: requestedVersion !== undefined && requestedVersion !== selectedVersion,
	};
}
