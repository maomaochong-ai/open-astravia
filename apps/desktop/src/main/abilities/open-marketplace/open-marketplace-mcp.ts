import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { z } from "zod";
import type { McpServerConfigData } from "../../../preload/api-types/mcp.js";
import { validateMcpConfig } from "../../mcp-config-validation.js";
import type { MarketplaceAbilityManifest } from "./marketplace-schema.js";

const MCP_MANIFEST_FILE = "mcp.json";
const PLATFORM_TAG_PATTERN = /^(win32|darwin|linux)-(x64|arm64)$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RUNTIME_EXECUTABLE_TOKEN = `\${VETTA_MCP_EXECUTABLE}`;

function isSafeRuntimeRelativePath(value: string): boolean {
	const slashPath = value.replace(/\\/g, "/");
	if (!slashPath || slashPath.includes("\0") || slashPath.startsWith("/") || /^[a-zA-Z]:\//.test(slashPath)) {
		return false;
	}
	const normalized = posix.normalize(slashPath).replace(/^\.\//, "").replace(/\/$/, "");
	return Boolean(normalized && normalized !== "." && normalized !== ".." && !normalized.startsWith("../"));
}

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

const managedBinaryPlatformSchema = z
	.object({
		url: z
			.string()
			.url()
			.refine((value) => {
				const url = new URL(value);
				return url.protocol === "https:" && !url.username && !url.password;
			}, "runtime URL must use HTTPS without embedded credentials"),
		sha256: z.string().regex(SHA256_PATTERN),
		archive: z.enum(["file", "zip"]),
		executable: z
			.string()
			.min(1)
			.refine(isSafeRuntimeRelativePath, "runtime executable must be a safe relative path"),
	})
	.strict();

const managedBinaryRuntimeSchema = z
	.object({
		kind: z.literal("managed-binary"),
		platforms: z
			.record(z.string().regex(PLATFORM_TAG_PATTERN), managedBinaryPlatformSchema)
			.refine((value) => Object.keys(value).length > 0, "runtime must support at least one platform"),
	})
	.strict();

const openMarketplaceMcpManifestV1Schema = z
	.object({
		schemaVersion: z.literal(1),
		slug: z.string().min(1),
		version: z.string().min(1),
		server: z.record(z.string(), z.unknown()),
		parameters: z.array(mcpParameterSchema).default([]),
		browserAuth: z.boolean().default(false),
	})
	.strict();

const openMarketplaceMcpManifestV2Schema = openMarketplaceMcpManifestV1Schema.extend({
	schemaVersion: z.literal(2),
	runtime: managedBinaryRuntimeSchema.optional(),
});

const openMarketplaceMcpManifestSchema = z.discriminatedUnion("schemaVersion", [
	openMarketplaceMcpManifestV1Schema,
	openMarketplaceMcpManifestV2Schema,
]);

export type OpenMarketplaceMcpRuntime = z.infer<typeof managedBinaryRuntimeSchema>;

type OpenMarketplaceMcpAbility = Extract<MarketplaceAbilityManifest, { type: "mcp" }>;

export interface OpenMarketplaceMcpConfig {
	[key: string]: unknown;
	mcp: Record<string, unknown>;
	mcp_browser_auth: boolean;
	mcp_runtime?: {
		kind: "managed-binary";
		supported: boolean;
	};
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

function loadOpenMarketplaceMcpPackage(
	sourceDir: string,
	ability: OpenMarketplaceMcpAbility,
): {
	manifest: z.infer<typeof openMarketplaceMcpManifestSchema>;
	server: McpServerConfigData;
	runtime?: OpenMarketplaceMcpRuntime;
} {
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
	const runtime = manifest.schemaVersion === 2 ? manifest.runtime : undefined;
	if (runtime) {
		if (server.type === "http") throw new Error("Managed MCP runtimes require a stdio server");
		if (server.command !== RUNTIME_EXECUTABLE_TOKEN) {
			throw new Error(`Managed MCP runtime command must be exactly ${RUNTIME_EXECUTABLE_TOKEN}`);
		}
	}
	return { manifest, server, ...(runtime ? { runtime } : {}) };
}

export function validateOpenMarketplaceMcp(
	sourceDir: string,
	ability: OpenMarketplaceMcpAbility,
): OpenMarketplaceMcpConfig {
	const { manifest, server, runtime } = loadOpenMarketplaceMcpPackage(sourceDir, ability);
	return {
		mcp: { ...server },
		mcp_browser_auth: manifest.browserAuth,
		mcp_parameters: manifest.parameters,
		...(runtime
			? {
					mcp_runtime: {
						kind: runtime.kind,
						supported: Boolean(runtime.platforms[`${process.platform}-${process.arch}`]),
					},
				}
			: {}),
	};
}

export function readOpenMarketplaceMcpPackage(
	sourceDir: string,
	ability: OpenMarketplaceMcpAbility,
): { server: McpServerConfigData; runtime?: OpenMarketplaceMcpRuntime } {
	const { server, runtime } = loadOpenMarketplaceMcpPackage(sourceDir, ability);
	return { server, ...(runtime ? { runtime } : {}) };
}
