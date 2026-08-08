import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./plugin-dev-watch.js", () => ({ startPluginDevWatch: vi.fn() }));

import { resolveConfiguredPluginDevProjects } from "./plugin-dev-bootstrap.js";

const testRoot = join(process.cwd(), `.tmp-plugin-dev-bootstrap-${process.pid}`);

async function writeProject(directory: string, id: string): Promise<void> {
	await mkdir(directory, { recursive: true });
	await writeFile(join(directory, "plugin.json"), JSON.stringify({ id }));
}

afterEach(async () => {
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
});
