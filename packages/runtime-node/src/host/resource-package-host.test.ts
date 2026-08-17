import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	createNodeResourcePackageHost,
	createNodeResourcePackageLocationFacts,
	NodeResourcePackageCommands,
	NodeResourcePackageEnvironment,
	NodeResourcePackageFiles,
	NpmResourcePackageRegistry,
	nodeResourcePackageDigest,
} from "./resource-package-host.js";

describe("Node resource package host", () => {
	it("composes the complete Node package host without upper-layer dependencies", () => {
		const host = createNodeResourcePackageHost();
		expect(host.commands).toBeInstanceOf(NodeResourcePackageCommands);
		expect(host.files).toBeInstanceOf(NodeResourcePackageFiles);
		expect(host.registry).toBeInstanceOf(NpmResourcePackageRegistry);
		expect(host.environment).toBeInstanceOf(NodeResourcePackageEnvironment);
		expect(host.resourceAccess.paths.separator).toBe(path.sep);
		expect(host.digest).toBe(nodeResourcePackageDigest);
	});

	it("provides stable SHA-256 digests for compatible cache paths", () => {
		expect(nodeResourcePackageDigest.sha256Hex("git-github.com-user/repo")).toBe(
			"338a107658675a6b6df89d42ce3e921fd6bb3cd84d3133e8b1f6d5de30e7abab",
		);
	});

	it("uses explicit location facts without querying the package runtime", () => {
		const facts = createNodeResourcePackageLocationFacts({
			homeDirectory: "C:/home",
			temporaryDirectory: "C:/temp",
			globalNpmRoot: "C:/global/node_modules",
		});
		expect(facts).toEqual({
			homeDirectory: "C:/home",
			temporaryDirectory: "C:/temp",
			getGlobalNpmRoot: expect.any(Function),
		});
		expect(facts.getGlobalNpmRoot()).toBe("C:/global/node_modules");
	});

	it.each(["1", "true", "TRUE", "yes", "YES"])("recognizes %s as offline", (value) => {
		expect(new NodeResourcePackageEnvironment({ env: { PI_OFFLINE: value } }).isOffline()).toBe(true);
	});

	it("keeps unrelated and false-like environment values online", () => {
		expect(new NodeResourcePackageEnvironment({ env: {} }).isOffline()).toBe(false);
		expect(new NodeResourcePackageEnvironment({ env: { PI_OFFLINE: "false" } }).isOffline()).toBe(false);
	});

	it("fetches the latest npm version with a timeout signal", async () => {
		const fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ version: "1.2.3" }),
		});
		const registry = new NpmResourcePackageRegistry({ fetch, timeoutMs: 25 });

		await expect(registry.getLatestVersion("example")).resolves.toBe("1.2.3");
		expect(fetch).toHaveBeenCalledWith("https://registry.npmjs.org/example/latest", {
			signal: expect.any(AbortSignal),
		});
	});

	it("keeps package file transactions behind the Node host", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "resource-package-files-"));
		const files = new NodeResourcePackageFiles();
		const packageJson = path.join(root, "nested", "package.json");

		await files.ensureTextFile(packageJson, "{}\n");
		await files.ensureTextFile(packageJson, "changed\n");
		expect(await files.stat(packageJson)).toEqual({ kind: "file" });
		expect(await files.readText(packageJson)).toBe("{}\n");
		expect(await files.readDirectory(path.dirname(packageJson))).toEqual(["package.json"]);

		await files.removeTree(path.join(root, "nested"));
		expect(await files.stat(path.join(root, "nested"))).toBeUndefined();
		await files.removeTree(root);
	});
});
