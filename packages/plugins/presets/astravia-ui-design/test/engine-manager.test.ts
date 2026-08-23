import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginCommandApi, PluginContext } from "@astravia-org/plugin-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { engineFilesHash } from "../src/engine/engine-files";
import { engineReady, migrateLegacyEngine, startDesignServer } from "../src/engine/engine-manager";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const runNode: PluginCommandApi["run"] = async (file, args = [], options) => {
	if (file !== "node") throw new Error(`Unexpected command: ${file}`);
	const result = spawnSync(process.execPath, args, {
		encoding: "utf8",
		env: { ...process.env, ...options?.env },
	});
	if (result.error) throw result.error;
	return {
		stdout: result.stdout,
		stderr: result.stderr,
		exitCode: result.status,
	};
};

function pluginContext(): PluginContext {
	return { command: { run: runNode } } as unknown as PluginContext;
}

async function temporaryHome(): Promise<string> {
	const home = await mkdtemp(join(tmpdir(), "vetd-engine-home-"));
	temporaryDirectories.push(home);
	return home;
}

describe("design engine data migration", () => {
	it("moves the legacy engine tree into the plugin data directory", async () => {
		const home = await temporaryHome();
		const legacyRoot = join(home, ".astravia", "design-engine");
		const targetRoot = join(home, ".astravia", "plugin-data", "astravia-ui-design", "design-engine");
		await mkdir(join(legacyRoot, "0.3.0"), { recursive: true });
		await writeFile(join(legacyRoot, "0.3.0", "marker.txt"), "legacy");

		await migrateLegacyEngine(pluginContext(), home);

		await expect(readFile(join(targetRoot, "0.3.0", "marker.txt"), "utf8")).resolves.toBe("legacy");
		await expect(readFile(join(legacyRoot, "0.3.0", "marker.txt"), "utf8")).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	it("does not overwrite a version that already exists in plugin data", async () => {
		const home = await temporaryHome();
		const legacyRoot = join(home, ".astravia", "design-engine");
		const targetRoot = join(home, ".astravia", "plugin-data", "astravia-ui-design", "design-engine");
		await mkdir(join(legacyRoot, "0.2.0"), { recursive: true });
		await mkdir(join(legacyRoot, "0.3.0"), { recursive: true });
		await mkdir(join(targetRoot, "0.3.0"), { recursive: true });
		await writeFile(join(legacyRoot, "0.2.0", "marker.txt"), "migrate");
		await writeFile(join(legacyRoot, "0.3.0", "marker.txt"), "legacy-current");
		await writeFile(join(targetRoot, "0.3.0", "marker.txt"), "existing-current");

		await migrateLegacyEngine(pluginContext(), home);

		await expect(readFile(join(targetRoot, "0.2.0", "marker.txt"), "utf8")).resolves.toBe("migrate");
		await expect(readFile(join(targetRoot, "0.3.0", "marker.txt"), "utf8")).resolves.toBe("existing-current");
		await expect(readFile(join(legacyRoot, "0.3.0", "marker.txt"), "utf8")).resolves.toBe("legacy-current");
	});

	it("checks readiness without the project filesystem capability", async () => {
		const home = await temporaryHome();
		const engineRoot = join(home, ".astravia", "plugin-data", "astravia-ui-design", "design-engine", "0.3.0");
		await mkdir(join(engineRoot, "node_modules", "vite"), { recursive: true });
		await writeFile(join(engineRoot, ".files-hash"), engineFilesHash());
		await writeFile(join(engineRoot, "node_modules", "vite", "package.json"), "{}");

		await expect(engineReady(pluginContext(), engineRoot)).resolves.toBe(true);
		await rm(join(engineRoot, "node_modules", "vite", "package.json"));
		await expect(engineReady(pluginContext(), engineRoot)).resolves.toBe(false);
	});
});

describe("startDesignServer env", () => {
	it("passes the design dir to the engine as ASTD_SRC (matches the vite config template)", async () => {
		const designDir = "/w/fake-design.astd";
		let capturedEnv: Record<string, string> | undefined;
		const ctx = {
			command: {
				run: async (_file: string, args: string[] = []) => {
					if (args.includes("-p")) {
						return { exitCode: 0, stdout: "/tmp/fake-home", stderr: "" };
					}
					const script = args[1] ?? "";
					if (script.includes("VETD_ENGINE_LEGACY")) {
						return { exitCode: 0, stdout: "absent", stderr: "" };
					}
					if (script.includes(".files-hash")) {
						return { exitCode: 0, stdout: JSON.stringify({ hash: engineFilesHash(), vite: true }), stderr: "" };
					}
					return { exitCode: 0, stdout: "ok", stderr: "" };
				},
				spawn: async (_file: string, _args: string[], options: { env?: Record<string, string> }) => {
					capturedEnv = options.env;
					return {
						port: 54321,
						stop: async () => {},
						onExit: () => {},
						status: async () => ({ running: true, recentOutput: "" }),
					};
				},
			},
			fs: {},
		} as unknown as PluginContext;

		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => ({ ok: true, status: 200 })) as typeof fetch;
		try {
			const server = await startDesignServer(ctx, designDir, () => {});
			expect(server.port).toBe(54321);
			expect(capturedEnv?.ASTD_SRC).toBe(designDir);
			expect(capturedEnv?.VETD_SRC).toBeUndefined();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});