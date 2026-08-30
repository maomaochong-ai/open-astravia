import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import AdmZip from "adm-zip";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenMarketplaceMcpRuntime } from "./open-marketplace-mcp";
import { OpenMarketplaceMcpRuntimeInstaller } from "./open-marketplace-mcp-runtime";

const temporaryRoots: string[] = [];
const PLATFORM_TAG = "win32-x64";
const RUNTIME_COMMAND = `\${VETTA_MCP_EXECUTABLE}`;

async function temporaryRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "vetta-mcp-runtime-test-"));
	temporaryRoots.push(root);
	return root;
}

function sha256(buffer: Buffer): string {
	return createHash("sha256").update(buffer).digest("hex");
}

function response(buffer: Buffer): Response {
	return new Response(new Uint8Array(buffer), {
		status: 200,
		headers: { "content-length": String(buffer.byteLength) },
	});
}

function runtime(
	buffer: Buffer,
	overrides?: Partial<OpenMarketplaceMcpRuntime["platforms"][string]>,
): OpenMarketplaceMcpRuntime {
	return {
		kind: "managed-binary",
		platforms: {
			[PLATFORM_TAG]: {
				url: "https://github.com/example/demo/releases/download/v1/demo.exe",
				sha256: sha256(buffer),
				archive: "file",
				executable: "demo.exe",
				...overrides,
			},
		},
	};
}

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("OpenMarketplaceMcpRuntimeInstaller", () => {
	it("installs a verified executable and resolves runtime/data/cache tokens", async () => {
		const rootDir = await temporaryRoot();
		const artifact = Buffer.from("managed-mcp-runtime");
		const fetchArtifact = vi.fn(async () => response(artifact));
		const installer = new OpenMarketplaceMcpRuntimeInstaller({ rootDir, platformTag: PLATFORM_TAG, fetchArtifact });

		const server = await installer.prepare({
			sourceId: "official",
			slug: "demo-mcp",
			version: "1.0.0",
			runtime: runtime(artifact),
			server: {
				command: RUNTIME_COMMAND,
				args: [`--data=\${VETTA_MCP_DATA_DIR}`],
				env: {
					RUNTIME_DIR: `\${VETTA_MCP_RUNTIME_DIR}`,
					CACHE_DIR: `\${VETTA_MCP_CACHE_DIR}`,
				},
			},
		});

		expect(server.type).toBeUndefined();
		if (server.type === "http") throw new Error("Expected stdio server");
		expect(server.command).toMatch(/demo-mcp-[a-f0-9]{12}[/\\]runtime[/\\]versions[/\\]1\.0\.0[/\\]demo\.exe$/);
		await expect(readFile(server.command, "utf8")).resolves.toBe("managed-mcp-runtime");
		expect(server.args?.[0]).toContain(join(dirname(dirname(dirname(dirname(server.command)))), "data"));
		expect(server.env?.RUNTIME_DIR).toBe(dirname(server.command));
		expect(server.env?.CACHE_DIR).toContain(join("demo-mcp-"));
		expect(fetchArtifact).toHaveBeenCalledOnce();
	});

	it("extracts a ZIP safely and reuses an already verified version", async () => {
		const rootDir = await temporaryRoot();
		const zip = new AdmZip();
		zip.addFile("release/bin/demo", Buffer.from("zip-runtime"));
		const artifact = zip.toBuffer();
		const fetchArtifact = vi.fn(async () => response(artifact));
		const installer = new OpenMarketplaceMcpRuntimeInstaller({ rootDir, platformTag: PLATFORM_TAG, fetchArtifact });
		const input = {
			sourceId: "official",
			slug: "demo-mcp",
			version: "1.0.0",
			runtime: runtime(artifact, { archive: "zip", executable: "release/bin/demo" }),
			server: { command: RUNTIME_COMMAND },
		} as const;

		const first = await installer.prepare(input);
		const second = await installer.prepare(input);

		if (first.type === "http" || second.type === "http") throw new Error("Expected stdio server");
		await expect(readFile(first.command, "utf8")).resolves.toBe("zip-runtime");
		expect(second.command).toBe(first.command);
		expect(fetchArtifact).toHaveBeenCalledOnce();
	});

	it("preserves the installed version when a replacement fails integrity verification", async () => {
		const rootDir = await temporaryRoot();
		const firstArtifact = Buffer.from("known-good-runtime");
		const installer = new OpenMarketplaceMcpRuntimeInstaller({
			rootDir,
			platformTag: PLATFORM_TAG,
			fetchArtifact: vi
				.fn()
				.mockResolvedValueOnce(response(firstArtifact))
				.mockResolvedValueOnce(response(Buffer.from("tampered-runtime"))),
		});
		const first = await installer.prepare({
			sourceId: "official",
			slug: "demo-mcp",
			version: "1.0.0",
			runtime: runtime(firstArtifact),
			server: { command: RUNTIME_COMMAND },
		});
		if (first.type === "http") throw new Error("Expected stdio server");

		await expect(
			installer.prepare({
				sourceId: "official",
				slug: "demo-mcp",
				version: "1.0.0",
				runtime: runtime(Buffer.from("expected-new-runtime")),
				server: { command: RUNTIME_COMMAND },
			}),
		).rejects.toThrow("SHA-256 mismatch");
		await expect(readFile(first.command, "utf8")).resolves.toBe("known-good-runtime");
	});

	it("rejects unsupported platforms and escaping executable paths before downloading", async () => {
		const rootDir = await temporaryRoot();
		const artifact = Buffer.from("runtime");
		const fetchArtifact = vi.fn(async () => response(artifact));
		const installer = new OpenMarketplaceMcpRuntimeInstaller({ rootDir, platformTag: PLATFORM_TAG, fetchArtifact });

		await expect(
			installer.prepare({
				sourceId: "official",
				slug: "demo-mcp",
				version: "1.0.0",
				runtime: {
					...runtime(artifact),
					platforms: { "linux-arm64": runtime(artifact).platforms[PLATFORM_TAG]! },
				},
				server: { command: RUNTIME_COMMAND },
			}),
		).rejects.toThrow("does not support platform");

		await expect(
			installer.prepare({
				sourceId: "official",
				slug: "demo-mcp",
				version: "1.0.0",
				runtime: runtime(artifact, { executable: "../escape.exe" }),
				server: { command: RUNTIME_COMMAND },
			}),
		).rejects.toThrow("must stay inside the runtime directory");
		expect(fetchArtifact).not.toHaveBeenCalled();
	});

	it("removes runtime files while preserving user data", async () => {
		const rootDir = await temporaryRoot();
		const artifact = Buffer.from("runtime");
		const installer = new OpenMarketplaceMcpRuntimeInstaller({
			rootDir,
			platformTag: PLATFORM_TAG,
			fetchArtifact: async () => response(artifact),
		});
		const server = await installer.prepare({
			sourceId: "official",
			slug: "demo-mcp",
			version: "1.0.0",
			runtime: runtime(artifact),
			server: { command: RUNTIME_COMMAND },
		});
		if (server.type === "http") throw new Error("Expected stdio server");
		const abilityDirectory = dirname(dirname(dirname(dirname(server.command))));
		await mkdir(join(abilityDirectory, "data"), { recursive: true });
		await writeFile(join(abilityDirectory, "data", "cookies.json"), "session", "utf8");

		await installer.remove("official", "demo-mcp");

		await expect(readFile(server.command, "utf8")).rejects.toThrow();
		await expect(readFile(join(abilityDirectory, "data", "cookies.json"), "utf8")).resolves.toBe("session");
	});
});
