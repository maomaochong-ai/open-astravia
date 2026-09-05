import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { z } from "zod";
import type { McpServerConfigData } from "../../../preload/api-types/mcp.js";
import { validateMcpConfig } from "../../mcp-config-validation.js";
import type { MarketplaceAbilityManifest } from "./marketplace-schema.js";
import { isManagedHttpPath } from "./open-marketplace-managed-http-runtime.js";

const MCP_MANIFEST_FILE = "mcp.json";
const PLATFORM_TAG_PATTERN = /^(win32|darwin|linux)-(x64|arm64)$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RUNTIME_PORT_TOKEN = `\${VETTA_MCP_PORT}`;
const RUNTIME_URL_TOKEN = `\${VETTA_MCP_URL}`;

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

const mcpSetupSchema = z
	.object({
		kind: z.literal("http-qrcode"),
		statusPath: z.string().refine(isManagedHttpPath),
		qrcodePath: z.string().refine(isManagedHttpPath),
		logoutPath: z.string().refine(isManagedHttpPath),
	})
	.strict();

/**
 * 二进制本身就是个本地 HTTP MCP 服务（只监听端口、没有 stdio 模式）时用这个声明。
 * Desktop 直接连接其 Streamable HTTP 端点；端口在每次启动时分配。
 */
const managedServiceSchema = z
	.object({
		kind: z.literal("http-mcp"),
		path: z.string().refine(isManagedHttpPath),
		readyTimeoutMs: z.number().int().positive().max(600_000).optional(),
	})
	.strict();

const managedBinaryRuntimeSchema = z
	.object({
		kind: z.literal("managed-binary"),
		process: z
			.object({
				args: z.array(z.string()).default([]),
				env: z.record(z.string(), z.string()).default({}),
				cwd: z.string().optional(),
			})
			.strict(),
		service: managedServiceSchema,
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

const openMarketplaceMcpManifestV3Schema = openMarketplaceMcpManifestV1Schema.extend({
	schemaVersion: z.literal(3),
	runtime: managedBinaryRuntimeSchema.optional(),
	setup: mcpSetupSchema.optional(),
});

const openMarketplaceMcpManifestSchema = z.discriminatedUnion("schemaVersion", [
	openMarketplaceMcpManifestV1Schema,
	openMarketplaceMcpManifestV3Schema,
]);

export type OpenMarketplaceMcpRuntime = z.infer<typeof managedBinaryRuntimeSchema>;
export type OpenMarketplaceMcpSetup = z.infer<typeof mcpSetupSchema>;
export type OpenMarketplaceMcpService = z.infer<typeof managedServiceSchema>;

type OpenMarketplaceMcpAbility = Extract<MarketplaceAbilityManifest, { type: "mcp" }>;

export interface OpenMarketplaceMcpConfig {
	[key: string]: unknown;
	mcp: Record<string, unknown>;
	mcp_browser_auth: boolean;
	mcp_runtime?: {
		kind: "managed-binary";
		supported: boolean;
	};
	mcp_setup?: {
		kind: "http-qrcode";
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
	setup?: OpenMarketplaceMcpSetup;
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
	const runtime = manifest.schemaVersion === 3 ? manifest.runtime : undefined;
	if (runtime) {
		if (server.type !== "http") throw new Error("Managed HTTP MCP runtimes require an HTTP server");
		if (server.url !== RUNTIME_URL_TOKEN) {
			throw new Error(`Managed HTTP MCP runtime URL must be exactly ${RUNTIME_URL_TOKEN}`);
		}
		if (
			![...runtime.process.args, ...Object.values(runtime.process.env)].some((value) =>
				value.includes(RUNTIME_PORT_TOKEN),
			)
		) {
			throw new Error(`Managed MCP services must pass ${RUNTIME_PORT_TOKEN} to the process`);
		}
	}
	const setup = manifest.schemaVersion === 3 ? manifest.setup : undefined;
	if (setup && !runtime) throw new Error("Post-install setup requires a managed MCP runtime");
	return { manifest, server, ...(runtime ? { runtime } : {}), ...(setup ? { setup } : {}) };
}

export function validateOpenMarketplaceMcp(
	sourceDir: string,
	ability: OpenMarketplaceMcpAbility,
): OpenMarketplaceMcpConfig {
	const { manifest, server, runtime, setup } = loadOpenMarketplaceMcpPackage(sourceDir, ability);
	return {
		mcp: { ...server },
		mcp_browser_auth: manifest.browserAuth,
		mcp_parameters: manifest.parameters,
		...(setup ? { mcp_setup: { kind: setup.kind } } : {}),
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
): { server: McpServerConfigData; runtime?: OpenMarketplaceMcpRuntime; setup?: OpenMarketplaceMcpSetup } {
	const { server, runtime, setup } = loadOpenMarketplaceMcpPackage(sourceDir, ability);
	return { server, ...(runtime ? { runtime } : {}), ...(setup ? { setup } : {}) };
}
