import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginCommandApi, PluginContext } from "@vetta-org/plugin-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { engineFilesHash } from "../src/engine/engine-files";
import { engineReady, migrateLegacyEngine } from "../src/engine/engine-manager";

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
		const legacyRoot = join(home, ".vetta", "design-engine");
		const targetRoot = join(home, ".vetta", "plugin-data", "vetta-ui-design", "design-engine");
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
		const legacyRoot = join(home, ".vetta", "design-engine");
		const targetRoot = join(home, ".vetta", "plugin-data", "vetta-ui-design", "design-engine");
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
		const engineRoot = join(home, ".vetta", "plugin-data", "vetta-ui-design", "design-engine", "0.3.0");
		await mkdir(join(engineRoot, "node_modules", "vite"), { recursive: true });
		await writeFile(join(engineRoot, ".files-hash"), engineFilesHash());
		await writeFile(join(engineRoot, "node_modules", "vite", "package.json"), "{}");

		await expect(engineReady(pluginContext(), engineRoot)).resolves.toBe(true);
		await rm(join(engineRoot, "node_modules", "vite", "package.json"));
		await expect(engineReady(pluginContext(), engineRoot)).resolves.toBe(false);
	});
});
