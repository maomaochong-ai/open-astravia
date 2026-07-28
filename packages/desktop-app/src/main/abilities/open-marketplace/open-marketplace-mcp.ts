import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { validateMcpConfig } from "../../mcp-config-validation.js";
import type { MarketplaceAbilityManifest } from "./marketplace-schema.js";

const MCP_MANIFEST_FILE = "mcp.json";

const mcpParameterSchema = z
	.object({
		key: z.string().min(1),
		label: z.string().min(1),
		required: z.boolean().default(false),
		secret: z.boolean().default(false),
		placeholder: z.string().optional(),
		helpUrl: z.string().url().optional(),
		valueTemplate: z
			.string()
			.refine((value) => value.includes("{value}"), "valueTemplate must contain {value}")
			.optional(),
	})
	.strict();

const openMarketplaceMcpManifestSchema = z
	.object({
		schemaVersion: z.literal(1),
		slug: z.string().min(1),
		version: z.string().min(1),
		server: z.record(z.string(), z.unknown()),
		parameters: z.array(mcpParameterSchema).default([]),
	})
	.strict();

type OpenMarketplaceMcpAbility = Extract<MarketplaceAbilityManifest, { type: "mcp" }>;

export interface OpenMarketplaceMcpConfig {
	[key: string]: unknown;
	mcp: Record<string, unknown>;
	mcp_parameters: Array<{
		key: string;
		label: string;
		required: boolean;
		secret: boolean;
		placeholder?: string;
		helpUrl?: string;
		valueTemplate?: string;
	}>;
}

export function validateOpenMarketplaceMcp(
	sourceDir: string,
	ability: OpenMarketplaceMcpAbility,
): OpenMarketplaceMcpConfig {
	const manifestPath = join(sourceDir, MCP_MANIFEST_FILE);
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(manifestPath, "utf-8")) as unknown;
	} catch (error) {
		throw new Error(`Invalid MCP package ${ability.slug}: cannot read ${MCP_MANIFEST_FILE}`, { cause: error });
	}
	const manifest = openMarketplaceMcpManifestSchema.parse(raw);
	if (manifest.slug !== ability.slug) {
		throw new Error(`MCP package slug mismatch: expected ${ability.slug}, got ${manifest.slug}`);
	}
	if (manifest.version !== ability.version) {
		throw new Error(`MCP package version mismatch: expected ${ability.version}, got ${manifest.version}`);
	}
	const server = validateMcpConfig({ mcpServers: { [ability.slug]: manifest.server } }).mcpServers[ability.slug];
	if (!server) throw new Error(`MCP package server is missing: ${ability.slug}`);
	return { mcp: { ...server }, mcp_parameters: manifest.parameters };
}
