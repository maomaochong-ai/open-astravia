import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type CodingToolArchiveOperations,
	type CodingToolHttpResponse,
	createCodingToolDownloadPlan,
	createManagedCodingToolExecutableResolver,
	downloadCodingToolArchiveWithRetry,
	fetchLatestCodingToolVersion,
	installCodingToolArchive,
	type ManagedCodingToolExecutableDependencies,
	parseLatestReleaseVersion,
	resolveManagedCodingToolExecutable,
} from "../../src/coding/index.js";

function createDependencies(
	overrides: Partial<ManagedCodingToolExecutableDependencies> = {},
): ManagedCodingToolExecutableDependencies {
	return {
		getPath: () => null,
		isOffline: () => false,
		platform: () => "linux",
		download: async (tool) => `${tool}-downloaded`,
		...overrides,
	};
}

describe("managed coding-tool executables", () => {
	it("adapts custom resolution and preserves unavailable tools", async () => {
		const calls: string[] = [];
		const resolver = createManagedCodingToolExecutableResolver({
			toolsDirectory: "C:/vetta/bin",
			resolveExecutable: async (tool, silent) => {
				calls.push(`${tool}:${silent}`);
				return tool === "rg" ? "rg-path" : undefined;
			},
		});
		await expect(resolver.resolve("rg")).resolves.toBe("rg-path");
		await expect(resolver.resolve("fd")).resolves.toBeUndefined();
		expect(calls).toEqual(["rg:true", "fd:true"]);
	});

	it("prefers existing tools and skips downloads while offline or on Android", async () => {
		let downloads = 0;
		const download = async () => {
			downloads += 1;
			return "/downloaded/tool";
		};
		await expect(
			resolveManagedCodingToolExecutable("rg", true, createDependencies({ getPath: () => "/managed/rg", download })),
		).resolves.toBe("/managed/rg");
		await expect(
			resolveManagedCodingToolExecutable("rg", true, createDependencies({ isOffline: () => true, download })),
		).resolves.toBeUndefined();
		await expect(
			resolveManagedCodingToolExecutable("fd", true, createDependencies({ platform: () => "android", download })),
		).resolves.toBeUndefined();
		expect(downloads).toBe(0);
	});

	it("returns downloaded paths and maps download failures to unavailable", async () => {
		await expect(
			resolveManagedCodingToolExecutable("fd", true, createDependencies({ download: async () => "/downloaded/fd" })),
		).resolves.toBe("/downloaded/fd");
		await expect(
			resolveManagedCodingToolExecutable(
				"rg",
				true,
				createDependencies({ download: async () => Promise.reject(new Error("offline")) }),
			),
		).resolves.toBeUndefined();
	});

	it.each([
		["fd", "1.0.0", "darwin", "arm64", "fd-v1.0.0-aarch64-apple-darwin.tar.gz", "fd"],
		["fd", "1.0.0", "win32", "x64", "fd-v1.0.0-x86_64-pc-windows-msvc.zip", "fd.exe"],
		["rg", "14.1.0", "linux", "arm64", "ripgrep-14.1.0-aarch64-unknown-linux-gnu.tar.gz", "rg"],
		["rg", "14.1.0", "linux", "x64", "ripgrep-14.1.0-x86_64-unknown-linux-musl.tar.gz", "rg"],
	] as const)("creates the %s %s %s/%s download plan", (tool, version, platform, architecture, asset, binary) => {
		const plan = createCodingToolDownloadPlan({
			tool,
			version,
			platform,
			architecture,
			toolsDirectory: "C:/vetta/bin",
		});
		expect(plan?.assetName).toBe(asset);
		expect(plan?.binaryFileName).toBe(binary);
		expect(plan?.downloadUrl).toContain(`/releases/download/${tool === "fd" ? "v" : ""}${version}/`);
	});

	it("returns no plan for unsupported platforms", () => {
		expect(
			createCodingToolDownloadPlan({
				tool: "rg",
				version: "14.1.0",
				platform: "freebsd",
				architecture: "x64",
				toolsDirectory: "C:/vetta/bin",
			}),
		).toBeUndefined();
	});

	it.each([
		["darwin", ".tar.gz", true],
		["win32", ".zip", false],
	] as const)("installs %s archives and always cleans staging files", async (platform, extension, chmod) => {
		const plan = createCodingToolDownloadPlan({
			tool: platform === "win32" ? "rg" : "fd",
			version: platform === "win32" ? "14.1.0" : "1.0.0",
			platform,
			architecture: "x64",
			toolsDirectory: "C:/vetta/bin",
		});
		if (!plan || !plan.assetName.endsWith(extension)) throw new Error("expected matching plan");
		const extractDirectory = "C:/vetta/extract";
		const binary = join(extractDirectory, plan.binaryFileName);
		const calls: string[] = [];
		const operations: CodingToolArchiveOperations = {
			extractTarGz: () => calls.push("tar"),
			extractZip: async () => {
				calls.push("zip");
			},
			fileExists: (path) => path === binary,
			findBinary: () => null,
			moveFile: () => calls.push("move"),
			makeExecutable: () => calls.push("chmod"),
			removeFile: () => calls.push("remove-file"),
			removeDirectory: () => calls.push("remove-directory"),
		};
		await expect(installCodingToolArchive({ plan, extractDirectory, platform, operations })).resolves.toBe(
			plan.binaryPath,
		);
		expect(calls).toEqual([
			platform === "win32" ? "zip" : "tar",
			"move",
			...(chmod ? ["chmod"] : []),
			"remove-file",
			"remove-directory",
		]);
	});

	it("cleans staging files when an archive has no binary", async () => {
		const plan = createCodingToolDownloadPlan({
			tool: "rg",
			version: "14.1.0",
			platform: "linux",
			architecture: "x64",
			toolsDirectory: "C:/vetta/bin",
		});
		if (!plan) throw new Error("expected plan");
		const cleanup: string[] = [];
		const operations: CodingToolArchiveOperations = {
			extractTarGz: () => {},
			extractZip: async () => {},
			fileExists: () => false,
			findBinary: () => null,
			moveFile: () => {},
			makeExecutable: () => {},
			removeFile: () => cleanup.push("file"),
			removeDirectory: () => cleanup.push("directory"),
		};
		await expect(
			installCodingToolArchive({ plan, extractDirectory: "C:/extract", platform: "linux", operations }),
		).rejects.toThrow("Binary not found in archive");
		expect(cleanup).toEqual(["file", "directory"]);
	});

	it("parses latest releases and retries transient downloads", async () => {
		expect(parseLatestReleaseVersion({ tag_name: "v1.2.3" })).toBe("1.2.3");
		expect(() => parseLatestReleaseVersion({ tag_name: 14 })).toThrow("missing tag_name");
		let releaseUrl = "";
		const releaseRequest = async (url: string): Promise<CodingToolHttpResponse> => {
			releaseUrl = url;
			return {
				ok: true,
				status: 200,
				json: async () => ({ tag_name: "v1.2.3" }),
				arrayBuffer: async () => new ArrayBuffer(0),
			};
		};
		await expect(fetchLatestCodingToolVersion("sharkdp/fd", releaseRequest)).resolves.toBe("1.2.3");
		expect(releaseUrl).toContain("sharkdp/fd/releases/latest");

		const directory = mkdtempSync(join(tmpdir(), "runtime-node-download-"));
		const destination = join(directory, "tool.archive");
		let requests = 0;
		const downloadRequest = async (): Promise<CodingToolHttpResponse> => {
			requests += 1;
			if (requests < 3) throw new TypeError("temporary network failure");
			return {
				ok: true,
				status: 200,
				json: async () => ({}),
				arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
			};
		};
		try {
			await downloadCodingToolArchiveWithRetry("https://example.test/tool", destination, downloadRequest, {
				retryDelayMs: 0,
			});
			expect(requests).toBe(3);
			expect(readFileSync(destination)).toEqual(Buffer.from([1, 2, 3]));
			expect(existsSync(destination)).toBe(true);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
