import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareVendorRuntimes } from "./fetch-vendor-runtimes.mjs";

describe("release vendor download preparation", () => {
	let root;
	let archive;
	let options;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "vetta-vendor-test-"));
		mkdirSync(join(root, "payload"));
		writeFileSync(join(root, "payload/runtime"), "runtime fixture");
		execFileSync("tar", ["-czf", "fixture.tar.gz", "-C", join(root, "payload"), "."], { cwd: root });
		archive = readFileSync(join(root, "fixture.tar.gz"));
		const definition = {
			version: "1.0.0",
			sources: ["https://primary.invalid/{version}/{filename}", "https://fallback.invalid/{version}/{filename}"],
			platforms: { "linux-x64": { filename: "runtime.tar.gz", dir: "runtime" } },
		};
		options = {
			platformTag: "linux-x64",
			cacheDir: join(root, "cache"),
			manifest: { node: structuredClone(definition), python: structuredClone(definition) },
			log: () => undefined,
		};
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	it("prewarms archives, reuses them during packaging and only refetches changed runtime filenames", async () => {
		const requests = [];
		const fetchImpl = async (url) => {
			requests.push(url);
			return new Response(archive);
		};
		const warmed = await prepareVendorRuntimes({ ...options, fetchImpl });
		const reused = await prepareVendorRuntimes({ ...options, fetchImpl });
		expect(reused).toEqual(warmed);
		expect(requests).toHaveLength(2);
		for (const result of reused) expect(readFileSync(result.archivePath)).toEqual(archive);
		const manifest = structuredClone(options.manifest);
		manifest.node.platforms["linux-x64"].filename = "runtime-v2.tar.gz";
		await prepareVendorRuntimes({ ...options, manifest, fetchImpl });
		expect(requests).toHaveLength(3);
		expect(requests[2]).toContain("runtime-v2.tar.gz");
	});

	it("repairs a corrupt cache and uses the fallback when the primary returns an invalid archive", async () => {
		const warmed = await prepareVendorRuntimes({ ...options, fetchImpl: async () => new Response(archive) });
		writeFileSync(warmed[0].archivePath, "truncated");
		const requests = [];
		await prepareVendorRuntimes({
			...options,
			fetchImpl: async (url) => {
				requests.push(url);
				return new Response(url.includes("primary") ? "bad archive" : archive);
			},
		});
		expect(requests).toEqual([
			"https://primary.invalid/1.0.0/runtime.tar.gz",
			"https://fallback.invalid/1.0.0/runtime.tar.gz",
		]);
		expect(readFileSync(warmed[0].archivePath)).toEqual(archive);
	});

	it("prepares and reuses Windows ZIP runtimes even on a non-Windows build host", async () => {
		const zip = new AdmZip();
		zip.addFile("node/node.exe", Buffer.from("Windows runtime fixture"));
		const manifest = structuredClone(options.manifest);
		for (const definition of Object.values(manifest)) {
			definition.platforms = { "win32-x64": { filename: "runtime.zip", dir: "node" } };
		}
		const config = { ...options, manifest, platformTag: "win32-x64" };
		const warmed = await prepareVendorRuntimes({ ...config, fetchImpl: async () => new Response(zip.toBuffer()) });
		const reused = await prepareVendorRuntimes({
			...config,
			fetchImpl: async () => {
				throw new Error("must use cache");
			},
		});
		expect(reused).toEqual(warmed);
	});

	it("leaves no partial archive after a network failure and succeeds on the next attempt", async () => {
		await expect(
			prepareVendorRuntimes({
				...options,
				fetchImpl: async () => {
					throw new Error("network reset");
				},
			}),
		).rejects.toThrow("Cannot download vendor node");
		expect(readdirSync(join(options.cacheDir, "linux-x64/node"))).toEqual([]);
		const result = await prepareVendorRuntimes({ ...options, fetchImpl: async () => new Response(archive) });
		expect(result).toHaveLength(2);
	});

	it("rejects unsafe platform or manifest paths before downloading", async () => {
		await expect(prepareVendorRuntimes({ ...options, platformTag: "../linux-x64" })).rejects.toThrow(
			"Unsupported vendor platform",
		);
		const manifest = structuredClone(options.manifest);
		manifest.node.platforms["linux-x64"].filename = "../escape.tar.gz";
		await expect(prepareVendorRuntimes({ ...options, manifest })).rejects.toThrow("Invalid vendor manifest entry");
		expect(existsSync(options.cacheDir)).toBe(false);
	});
});
