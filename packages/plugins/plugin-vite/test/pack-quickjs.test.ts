import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createVettaPluginPackage } from "../src/pack.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("createVettaPluginPackage QuickJS runtime", () => {
	it("packages the script entry without treating it as a federation manifest", async () => {
		const rootDir = await mkdtemp(join(fileURLToPath(new URL(".", import.meta.url)), "tmp-pack-quickjs-"));
		temporaryDirectories.push(rootDir);
		await mkdir(join(rootDir, "dist"), { recursive: true });
		await mkdir(join(rootDir, "locales"), { recursive: true });
		await writeFile(
			join(rootDir, "plugin.json"),
			JSON.stringify({
				id: "quickjs-pack-test",
				name: "QuickJS pack test",
				version: "0.1.0",
				pluginApiVersion: "^1.0.0",
				runtime: "quickjs",
				entry: "dist/plugin.js",
				permissions: [],
			}),
		);
		await writeFile(join(rootDir, "dist", "plugin.js"), "vetta.activate(() => {});\n");
		await writeFile(join(rootDir, "locales", "en.json"), JSON.stringify({ title: "Test" }));

		const result = await createVettaPluginPackage({ rootDir });

		expect(result.files.map((file) => file.archivePath)).toEqual([
			"dist/plugin.js",
			"locales/en.json",
			"plugin.json",
		]);
		expect(result.outputPath).toBe(join(rootDir, "release", "quickjs-pack-test-0.1.0.zip"));
	});
});
