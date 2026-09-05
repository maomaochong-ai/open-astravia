import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MANAGED_HTTP_RUNTIME_FILE } from "./open-marketplace-managed-http-runtime";
import type { OpenMarketplaceMcpRuntime } from "./open-marketplace-mcp";
import { OpenMarketplaceMcpRuntimeInstaller } from "./open-marketplace-mcp-runtime";

const temporaryRoots: string[] = [];
const PLATFORM_TAG = "win32-x64";
const PORT_TOKEN = `\${VETTA_MCP_PORT}`;
const URL_TOKEN = `\${VETTA_MCP_URL}`;

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
		process: {
			args: [`-port=:${PORT_TOKEN}`],
			env: {
				DATA: `\${VETTA_MCP_DATA_DIR}`,
				CACHE: `\${VETTA_MCP_CACHE_DIR}`,
				RUNTIME: `\${VETTA_MCP_RUNTIME_DIR}`,
			},
		},
		service: { kind: "http-mcp", path: "/mcp", readyTimeoutMs: 300_000 },
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

const server = { type: "http", url: URL_TOKEN } as const;

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("OpenMarketplaceMcpRuntimeInstaller", () => {
	it("installs a verified runtime and emits a direct HTTP config plus lifecycle spec", async () => {
		const rootDir = await temporaryRoot();
		const artifact = Buffer.from("managed-mcp-runtime");
		const fetchArtifact = vi.fn(async () => response(artifact));
		const installer = new OpenMarketplaceMcpRuntimeInstaller({ rootDir, platformTag: PLATFORM_TAG, fetchArtifact });
		const progress: string[] = [];

		const installed = await installer.prepare({
			sourceId: "official",
			slug: "demo-mcp",
			version: "1.0.0",
			runtime: runtime(artifact),
			server,
			setup: {
				kind: "http-qrcode",
				statusPath: "/api/v1/login/status",
				qrcodePath: "/api/v1/login/qrcode",
				logoutPath: "/api/v1/login/cookies",
			},
			parameters: [{ key: "XHS_PROXY" }],
			onProgress: (event) => progress.push(event.phase),
		});

		expect(installed).toMatchObject({
			type: "http",
			url: "http://127.0.0.1/mcp",
			managedRuntimeId: expect.stringMatching(/^demo-mcp-[a-f0-9]{12}$/),
		});
		if (installed.type !== "http" || !installed.managedRuntimeId) throw new Error("Expected managed HTTP config");
		const abilityDirectory = join(rootDir, installed.managedRuntimeId);
		const spec = JSON.parse(await readFile(join(abilityDirectory, MANAGED_HTTP_RUNTIME_FILE), "utf8")) as Record<
			string,
			unknown
		>;
		expect(spec).toMatchObject({
			schemaVersion: 2,
			id: installed.managedRuntimeId,
			args: [`-port=:${PORT_TOKEN}`],
			mcpPath: "/mcp",
			readyTimeoutMs: 300_000,
			configurableEnvKeys: ["XHS_PROXY"],
			setup: { kind: "http-qrcode", statusPath: "/api/v1/login/status" },
		});
		expect(spec.command).toMatch(/runtime[/\\]versions[/\\]1\.0\.0[/\\]demo\.exe$/);
		expect((spec.env as Record<string, string>).DATA).toMatch(/demo-mcp-[0-9a-f]+[/\\]data$/);
		expect(fetchArtifact).toHaveBeenCalledOnce();
		expect(progress).toEqual(["preparing", "downloading", "downloading", "verifying", "installing", "ready"]);
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
			server,
		} as const;

		const first = await installer.prepare(input);
		const second = await installer.prepare(input);

		expect(second).toEqual(first);
		expect(fetchArtifact).toHaveBeenCalledOnce();
	});

	it("preserves the installed version when replacement integrity verification fails", async () => {
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
			server,
		});
		if (first.type !== "http" || !first.managedRuntimeId) throw new Error("Expected managed HTTP config");
		const executable = join(rootDir, first.managedRuntimeId, "runtime", "versions", "1.0.0", "demo.exe");

		await expect(
			installer.prepare({
				sourceId: "official",
				slug: "demo-mcp",
				version: "1.0.0",
				runtime: runtime(Buffer.from("expected-new-runtime")),
				server,
			}),
		).rejects.toThrow("SHA-256 mismatch");
		await expect(readFile(executable, "utf8")).resolves.toBe("known-good-runtime");
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
				runtime: { ...runtime(artifact), platforms: { "linux-arm64": runtime(artifact).platforms[PLATFORM_TAG]! } },
				server,
			}),
		).rejects.toThrow("does not support platform");

		await expect(
			installer.prepare({
				sourceId: "official",
				slug: "demo-mcp",
				version: "1.0.0",
				runtime: runtime(artifact, { executable: "../escape.exe" }),
				server,
			}),
		).rejects.toThrow("must stay inside the runtime directory");
		expect(fetchArtifact).not.toHaveBeenCalled();
	});

	it("removes runtime and lifecycle files while preserving user data", async () => {
		const rootDir = await temporaryRoot();
		const artifact = Buffer.from("runtime");
		const installer = new OpenMarketplaceMcpRuntimeInstaller({
			rootDir,
			platformTag: PLATFORM_TAG,
			fetchArtifact: async () => response(artifact),
		});
		const installed = await installer.prepare({
			sourceId: "official",
			slug: "demo-mcp",
			version: "1.0.0",
			runtime: runtime(artifact),
			server,
		});
		if (installed.type !== "http" || !installed.managedRuntimeId) throw new Error("Expected managed HTTP config");
		const abilityDirectory = join(rootDir, installed.managedRuntimeId);
		await mkdir(join(abilityDirectory, "data"), { recursive: true });
		await writeFile(join(abilityDirectory, "data", "cookies.json"), "session", "utf8");

		await installer.remove("official", "demo-mcp");

		await expect(readFile(join(abilityDirectory, MANAGED_HTTP_RUNTIME_FILE), "utf8")).rejects.toThrow();
		await expect(readFile(join(abilityDirectory, "runtime", "versions", "1.0.0", "demo.exe"))).rejects.toThrow();
		await expect(readFile(join(abilityDirectory, "data", "cookies.json"), "utf8")).resolves.toBe("session");
	});
});
