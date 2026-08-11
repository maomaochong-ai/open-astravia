import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolvePluginDevCliPath } from "./plugin-dev-cli.js";

const testRoot = join(tmpdir(), `.tmp-plugin-dev-watch-${process.pid}`);

afterEach(async () => {
	await rm(testRoot, { recursive: true, force: true });
});

describe("plugin development watch", () => {
	it("resolves the CLI through the project module graph", async () => {
		const projectRoot = join(testRoot, "installed");
		const packageDir = join(projectRoot, "node_modules", "@vetta-org", "plugin-vite");
		await mkdir(join(packageDir, "dist"), { recursive: true });
		await writeFile(join(projectRoot, "package.json"), JSON.stringify({ type: "module" }));
		await writeFile(
			join(packageDir, "package.json"),
			JSON.stringify({
				name: "@vetta-org/plugin-vite",
				version: "1.0.0",
				type: "module",
				exports: {
					".": { import: "./dist/index.js" },
					"./cli": "./dist/cli.js",
				},
			}),
		);
		await writeFile(join(packageDir, "dist", "index.js"), "export {};\n");
		await writeFile(join(packageDir, "dist", "cli.js"), "export {};\n");

		expect(resolvePluginDevCliPath(projectRoot)).toBe(join(packageDir, "dist", "cli.js"));
	});

	it("reports a missing project toolchain", async () => {
		const projectRoot = join(testRoot, "missing");
		await mkdir(projectRoot, { recursive: true });
		await writeFile(join(projectRoot, "package.json"), JSON.stringify({ type: "module" }));

		expect(() => resolvePluginDevCliPath(projectRoot)).toThrow("development CLI is not installed or built");
	});

	it("reports an installed plugin-vite version without the public CLI export", async () => {
		const projectRoot = join(testRoot, "incompatible");
		const packageDir = join(projectRoot, "node_modules", "@vetta-org", "plugin-vite");
		await mkdir(join(packageDir, "dist"), { recursive: true });
		await writeFile(join(projectRoot, "package.json"), JSON.stringify({ type: "module" }));
		await writeFile(
			join(packageDir, "package.json"),
			JSON.stringify({
				name: "@vetta-org/plugin-vite",
				version: "0.0.5",
				type: "module",
				exports: { ".": { import: "./dist/index.js" } },
			}),
		);
		await writeFile(join(packageDir, "dist", "index.js"), "export {};\n");

		expect(() => resolvePluginDevCliPath(projectRoot)).toThrow("does not expose its development CLI");
	});
});
