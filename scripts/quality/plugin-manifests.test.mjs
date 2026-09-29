import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePluginManifest } from "../../packages/plugins/plugin-sdk/src/manifest.ts";
import { repoRoot } from "./lib.mjs";

const IGNORED_DIRECTORIES = new Set([
	".git",
	".next",
	".turbo",
	"build",
	"coverage",
	"dist",
	"node_modules",
	"out",
	"release",
	"releases",
]);

function findPluginManifests(root) {
	const manifests = [];
	const pending = [root];
	while (pending.length > 0) {
		const directory = pending.pop();
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				if (!IGNORED_DIRECTORIES.has(entry.name)) pending.push(join(directory, entry.name));
				continue;
			}
			if (entry.name === "plugin.json") manifests.push(join(directory, entry.name));
		}
	}
	return manifests.sort();
}

describe("repository plugin manifests", () => {
	for (const manifestPath of findPluginManifests(repoRoot)) {
		const repositoryPath = relative(repoRoot, manifestPath).replaceAll("\\", "/");
		it(`${repositoryPath} satisfies the public manifest schema`, () => {
			const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
			expect(() => parsePluginManifest(raw)).not.toThrow();
		});
	}
});
