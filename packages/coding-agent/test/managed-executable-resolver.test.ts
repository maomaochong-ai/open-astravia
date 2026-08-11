import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
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
} from "../src/adapters/runtime-tools/executables/index.js";

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

describe("managed tool executable resolver adapter", () => {
	it("delegates resolution silently and preserves resolved paths", async () => {
		const calls: Array<{ readonly tool: "fd" | "rg"; readonly silent: boolean | undefined }> = [];
		const resolver = createManagedCodingToolExecutableResolver(async (tool, silent) => {
			calls.push({ tool, silent });
			return `${tool}-path`;
		});

		await expect(resolver.resolve("rg")).resolves.toBe("rg-path");
		await expect(resolver.resolve("fd")).resolves.toBe("fd-path");
		expect(calls).toEqual([
			{ tool: "rg", silent: true },
			{ tool: "fd", silent: true },
		]);
	});

	it("preserves unavailable tools as undefined", async () => {
		const resolver = createManagedCodingToolExecutableResolver(async () => undefined);

		await expect(resolver.resolve("rg")).resolves.toBeUndefined();
	});
});

describe("managed executable host behavior", () => {
	it("returns an existing executable without downloading", async () => {
		let downloads = 0;
		const dependencies = createDependencies({
			getPath: () => "/managed/rg",
			download: async () => {
				downloads += 1;
				return "/downloaded/rg";
			},
		});

		await expect(resolveManagedCodingToolExecutable("rg", true, dependencies)).resolves.toBe("/managed/rg");
		expect(downloads).toBe(0);
	});

	it("skips downloads in offline mode", async () => {
		let downloads = 0;
		const dependencies = createDependencies({
			isOffline: () => true,
			download: async () => {
				downloads += 1;
				return "/downloaded/rg";
			},
		});

		await expect(resolveManagedCodingToolExecutable("rg", true, dependencies)).resolves.toBeUndefined();
		expect(downloads).toBe(0);
	});

	it("skips downloads on Android/Termux", async () => {
		let downloads = 0;
		const dependencies = createDependencies({
			platform: () => "android",
			download: async () => {
				downloads += 1;
				return "/downloaded/fd";
			},
		});

		await expect(resolveManagedCodingToolExecutable("fd", true, dependencies)).resolves.toBeUndefined();
		expect(downloads).toBe(0);
	});

	it("returns downloaded paths and converts download failures to unavailable", async () => {
		const dependencies = createDependencies({
			download: async (tool) => `/downloaded/${tool}`,
		});
		await expect(resolveManagedCodingToolExecutable("fd", true, dependencies)).resolves.toBe("/downloaded/fd");

		const failedDependencies = createDependencies({
			download: async () => {
				throw new Error("network unavailable");
			},
		});
		await expect(resolveManagedCodingToolExecutable("rg", true, failedDependencies)).resolves.toBeUndefined();
	});
});

describe("tool download plans", () => {
	it.each([
		["fd", "1.0.0", "darwin", "arm64", "fd-v1.0.0-aarch64-apple-darwin.tar.gz", "fd"],
		["fd", "1.0.0", "win32", "x64", "fd-v1.0.0-x86_64-pc-windows-msvc.zip", "fd.exe"],
		["rg", "14.1.0", "linux", "arm64", "ripgrep-14.1.0-aarch64-unknown-linux-gnu.tar.gz", "rg"],
		["rg", "14.1.0", "linux", "x64", "ripgrep-14.1.0-x86_64-unknown-linux-musl.tar.gz", "rg"],
	] as const)(
		"creates a stable %s %s %s/%s plan",
		(tool, version, platform, architecture, assetName, binaryFileName) => {
			const plan = createCodingToolDownloadPlan({
				tool,
				version,
				platform,
				architecture,
				toolsDirectory: "C:/vetta/bin",
			});

			expect({
				...plan,
				archivePath: plan?.archivePath.replace(/\\/g, "/"),
				binaryPath: plan?.binaryPath.replace(/\\/g, "/"),
			}).toEqual({
				assetName,
				archivePath: `C:/vetta/bin/${assetName}`,
				binaryFileName,
				binaryPath: `C:/vetta/bin/${binaryFileName}`,
				downloadUrl: `https://github.com/${
					tool === "fd" ? "sharkdp/fd" : "BurntSushi/ripgrep"
				}/releases/download/${tool === "fd" ? "v" : ""}${version}/${assetName}`,
			});
		},
	);

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
});

describe("tool archive installation", () => {
	it("finds nested binaries, makes Unix binaries executable, and cleans up", async () => {
		const plan = createCodingToolDownloadPlan({
			tool: "fd",
			version: "1.0.0",
			platform: "darwin",
			architecture: "arm64",
			toolsDirectory: "C:/vetta/bin",
		});
		if (!plan) throw new Error("expected a download plan");

		const extractDirectory = "C:/vetta/extract-fd";
		const nestedBinary = join(extractDirectory, "fd-v1.0.0", plan.binaryFileName);
		const calls: string[] = [];
		const operations: CodingToolArchiveOperations = {
			extractTarGz: (archivePath, directory, assetName) => {
				calls.push(`tar:${archivePath}:${directory}:${assetName}`);
			},
			extractZip: async () => {
				throw new Error("zip should not be used");
			},
			fileExists: () => false,
			findBinary: () => nestedBinary,
			moveFile: (sourcePath, destinationPath) => calls.push(`move:${sourcePath}:${destinationPath}`),
			makeExecutable: (path) => calls.push(`chmod:${path}`),
			removeFile: (path) => calls.push(`remove-file:${path}`),
			removeDirectory: (path) => calls.push(`remove-directory:${path}`),
		};

		await expect(
			installCodingToolArchive({
				plan,
				extractDirectory,
				platform: "darwin",
				operations,
			}),
		).resolves.toBe(plan.binaryPath);
		expect(calls).toEqual([
			`tar:${plan.archivePath}:${extractDirectory}:${plan.assetName}`,
			`move:${nestedBinary}:${plan.binaryPath}`,
			`chmod:${plan.binaryPath}`,
			`remove-file:${plan.archivePath}`,
			`remove-directory:${extractDirectory}`,
		]);
	});

	it("uses zip archives on Windows without changing executable permissions", async () => {
		const plan = createCodingToolDownloadPlan({
			tool: "rg",
			version: "14.1.0",
			platform: "win32",
			architecture: "x64",
			toolsDirectory: "C:/vetta/bin",
		});
		if (!plan) throw new Error("expected a download plan");

		const extractDirectory = "C:/vetta/extract-rg";
		const extractedBinary = join(extractDirectory, plan.binaryFileName);
		const calls: string[] = [];
		const operations: CodingToolArchiveOperations = {
			extractTarGz: () => {
				throw new Error("tar should not be used");
			},
			extractZip: async (archivePath, directory) => {
				calls.push(`zip:${archivePath}:${directory}`);
			},
			fileExists: (path) => path === extractedBinary,
			findBinary: () => {
				throw new Error("recursive lookup should not be needed");
			},
			moveFile: (sourcePath, destinationPath) => calls.push(`move:${sourcePath}:${destinationPath}`),
			makeExecutable: () => {
				throw new Error("Windows binaries should not be chmod'ed");
			},
			removeFile: (path) => calls.push(`remove-file:${path}`),
			removeDirectory: (path) => calls.push(`remove-directory:${path}`),
		};

		await expect(
			installCodingToolArchive({
				plan,
				extractDirectory,
				platform: "win32",
				operations,
			}),
		).resolves.toBe(plan.binaryPath);
		expect(calls).toEqual([
			`zip:${plan.archivePath}:${extractDirectory}`,
			`move:${extractedBinary}:${plan.binaryPath}`,
			`remove-file:${plan.archivePath}`,
			`remove-directory:${extractDirectory}`,
		]);
	});

	it("cleans up the archive and extraction directory when the binary is missing", async () => {
		const plan = createCodingToolDownloadPlan({
			tool: "rg",
			version: "14.1.0",
			platform: "linux",
			architecture: "x64",
			toolsDirectory: "C:/vetta/bin",
		});
		if (!plan) throw new Error("expected a download plan");

		const extractDirectory = "C:/vetta/extract-rg";
		const cleanup: string[] = [];
		const operations: CodingToolArchiveOperations = {
			extractTarGz: () => {},
			extractZip: async () => {},
			fileExists: () => false,
			findBinary: () => null,
			moveFile: () => {
				throw new Error("move should not be attempted");
			},
			makeExecutable: () => {
				throw new Error("chmod should not be attempted");
			},
			removeFile: (path) => cleanup.push(`file:${path}`),
			removeDirectory: (path) => cleanup.push(`directory:${path}`),
		};

		await expect(
			installCodingToolArchive({
				plan,
				extractDirectory,
				platform: "linux",
				operations,
			}),
		).rejects.toThrow(`Binary not found in archive: expected ${plan.binaryFileName} under ${extractDirectory}`);
		expect(cleanup).toEqual([`file:${plan.archivePath}`, `directory:${extractDirectory}`]);
	});
});

describe("tool network boundaries", () => {
	it("parses release versions with and without a v prefix", () => {
		expect(parseLatestReleaseVersion({ tag_name: "v1.2.3" })).toBe("1.2.3");
		expect(parseLatestReleaseVersion({ tag_name: "14.1.0" })).toBe("14.1.0");
		expect(() => parseLatestReleaseVersion({ tag_name: 14 })).toThrow("missing tag_name");
	});

	it("fetches and parses the latest release response", async () => {
		let requestedUrl = "";
		const request = async (url: string): Promise<CodingToolHttpResponse> => {
			requestedUrl = url;
			return {
				ok: true,
				status: 200,
				json: async () => ({ tag_name: "v1.2.3" }),
				arrayBuffer: async () => new ArrayBuffer(0),
			};
		};

		await expect(fetchLatestCodingToolVersion("sharkdp/fd", request)).resolves.toBe("1.2.3");
		expect(requestedUrl).toBe("https://api.github.com/repos/sharkdp/fd/releases/latest");
	});

	it("does not retry HTTP errors from the release endpoint", async () => {
		let requests = 0;
		const request = async (): Promise<CodingToolHttpResponse> => {
			requests += 1;
			return {
				ok: false,
				status: 503,
				json: async () => ({}),
				arrayBuffer: async () => new ArrayBuffer(0),
			};
		};

		await expect(fetchLatestCodingToolVersion("BurntSushi/ripgrep", request)).rejects.toThrow(
			"GitHub API error: 503",
		);
		expect(requests).toBe(1);
	});

	it("retries transient download failures and writes the successful response", async () => {
		const directory = mkdtempSync(join(tmpdir(), "coding-agent-download-"));
		const destination = join(directory, "tool.archive");
		let requests = 0;
		const request = async (): Promise<CodingToolHttpResponse> => {
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
			await downloadCodingToolArchiveWithRetry("https://example.test/tool", destination, request, {
				retryDelayMs: 0,
			});
			expect(requests).toBe(3);
			expect(readFileSync(destination)).toEqual(Buffer.from([1, 2, 3]));
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("does not retry non-success download responses", async () => {
		let requests = 0;
		const request = async (): Promise<CodingToolHttpResponse> => {
			requests += 1;
			return {
				ok: false,
				status: 404,
				json: async () => ({}),
				arrayBuffer: async () => new ArrayBuffer(0),
			};
		};

		await expect(
			downloadCodingToolArchiveWithRetry("https://example.test/missing", "C:/missing.archive", request, {
				retryDelayMs: 0,
			}),
		).rejects.toThrow("Failed to download: 404");
		expect(requests).toBe(1);
	});

	it("installs a real locally-created tar.gz artifact and cleans staging files", async () => {
		const rootDirectory = mkdtempSync(join(tmpdir(), "coding-agent-artifact-"));
		const toolsDirectory = join(rootDirectory, "bin");
		const sourceDirectory = join(rootDirectory, "source");
		const extractDirectory = join(rootDirectory, "extract");
		mkdirSync(toolsDirectory, { recursive: true });
		mkdirSync(sourceDirectory, { recursive: true });
		mkdirSync(extractDirectory, { recursive: true });

		const plan = createCodingToolDownloadPlan({
			tool: "fd",
			version: "1.0.0",
			platform: "linux",
			architecture: "x64",
			toolsDirectory,
		});
		if (!plan) throw new Error("expected a download plan");

		const packageDirectory = plan.assetName.replace(/\.tar\.gz$/, "");
		const sourcePackageDirectory = join(sourceDirectory, packageDirectory);
		mkdirSync(sourcePackageDirectory, { recursive: true });
		const sourceBinary = join(sourcePackageDirectory, plan.binaryFileName);
		writeFileSync(sourceBinary, Buffer.from("fake fd executable"));

		try {
			const archiveResult = spawnSync("tar", ["-czf", plan.archivePath, "-C", sourceDirectory, packageDirectory], {
				encoding: "utf8",
			});
			expect(archiveResult.status, archiveResult.stderr).toBe(0);

			await expect(
				installCodingToolArchive({
					plan,
					extractDirectory,
					platform: "linux",
					operations: {
						extractTarGz: (archivePath, directory, assetName) => {
							const result = spawnSync("tar", ["xzf", archivePath, "-C", directory], {
								encoding: "utf8",
							});
							if (result.status !== 0) {
								throw new Error(`Failed to extract ${assetName}: ${result.stderr}`);
							}
						},
						extractZip: async () => {
							throw new Error("zip should not be used");
						},
						fileExists: existsSync,
						findBinary: () => null,
						moveFile: renameSync,
						makeExecutable: (path) => chmodSync(path, 0o755),
						removeFile: (path) => rmSync(path, { force: true }),
						removeDirectory: (path) => rmSync(path, { recursive: true, force: true }),
					},
				}),
			).resolves.toBe(plan.binaryPath);

			expect(readFileSync(plan.binaryPath)).toEqual(Buffer.from("fake fd executable"));
			expect(existsSync(plan.archivePath)).toBe(false);
			expect(existsSync(extractDirectory)).toBe(false);
		} finally {
			rmSync(rootDirectory, { recursive: true, force: true });
		}
	});
});
