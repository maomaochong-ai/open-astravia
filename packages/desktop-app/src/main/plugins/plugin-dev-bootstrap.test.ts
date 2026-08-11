import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ startPluginDevWatch: vi.fn() }));

vi.mock("./plugin-dev-watch.js", () => ({ startPluginDevWatch: mocks.startPluginDevWatch }));

import { resolveConfiguredPluginDevProjects, startConfiguredPluginDevWatches } from "./plugin-dev-bootstrap.js";

const testRoot = join(process.cwd(), `.tmp-plugin-dev-bootstrap-${process.pid}`);

async function writeProject(directory: string, id: string): Promise<void> {
	await mkdir(directory, { recursive: true });
	await writeFile(join(directory, "plugin.json"), JSON.stringify({ id }));
}

afterEach(async () => {
	vi.clearAllMocks();
	await rm(testRoot, { recursive: true, force: true });
});

describe("plugin development bootstrap", () => {
	it("resolves selected preset, external and explicit plugin roots", async () => {
		const desktopAppDir = join(testRoot, "packages", "desktop-app");
		const presetDir = join(testRoot, "packages", "plugins", "presets", "git");
		const externalDir = join(testRoot, "packages", "plugins", "externals", "preview");
		const customDir = join(testRoot, "custom", "notes");
		await Promise.all([
			mkdir(desktopAppDir, { recursive: true }),
			writeProject(presetDir, "git"),
			writeProject(externalDir, "preview"),
			writeProject(customDir, "notes"),
		]);

		await expect(
			resolveConfiguredPluginDevProjects({
				desktopAppDir,
				pluginIds: ["git", "preview"],
				pluginRoots: [customDir],
			}),
		).resolves.toEqual([
			{ id: "git", projectDir: presetDir },
			{ id: "preview", projectDir: externalDir },
			{ id: "notes", projectDir: customDir },
		]);
	});

	it("rejects unknown ids and duplicate plugin ids", async () => {
		const desktopAppDir = join(testRoot, "packages", "desktop-app");
		const firstDir = join(testRoot, "custom", "first");
		const secondDir = join(testRoot, "custom", "second");
		await Promise.all([
			mkdir(desktopAppDir, { recursive: true }),
			writeProject(firstDir, "duplicate"),
			writeProject(secondDir, "duplicate"),
		]);

		await expect(
			resolveConfiguredPluginDevProjects({ desktopAppDir, pluginIds: ["missing"], pluginRoots: [] }),
		).rejects.toThrow("Plugin development project not found: missing");
		await expect(
			resolveConfiguredPluginDevProjects({
				desktopAppDir,
				pluginIds: [],
				pluginRoots: [firstDir, secondDir],
			}),
		).rejects.toThrow("Duplicate plugin development id: duplicate");
	});

	it("starts independent projects in bounded batches and reports failures without hiding successes", async () => {
		const desktopAppDir = join(testRoot, "packages", "desktop-app");
		const presetRoot = join(testRoot, "packages", "plugins", "presets");
		await Promise.all([
			mkdir(desktopAppDir, { recursive: true }),
			...["alpha", "beta", "gamma", "delta", "epsilon"].map((id) => writeProject(join(presetRoot, id), id)),
		]);
		mocks.startPluginDevWatch.mockImplementation((id: string) => {
			if (id === "beta") return Promise.reject(new Error("beta unavailable"));
			return Promise.resolve({ id });
		});

		const result = await startConfiguredPluginDevWatches(desktopAppDir, {
			VETTA_PLUGIN_DEV: "alpha,beta,gamma,delta,epsilon",
		});

		expect(result.ready.map((project) => project.id)).toEqual(["alpha", "gamma", "delta", "epsilon"]);
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0]).toMatchObject({ project: { id: "beta" }, error: { message: "beta unavailable" } });
		expect(mocks.startPluginDevWatch).toHaveBeenCalledTimes(5);
	});
});
