import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
	createNodeDynamicModuleLoader,
	nodeFileUrlToPath,
	resolveNodeModuleSpecifier,
} from "./dynamic-module-loader.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("Node dynamic module loader", () => {
	it("executes TypeScript modules without retaining module state", async () => {
		const directory = await mkdtemp(join(tmpdir(), "runtime-node-module-loader-"));
		temporaryDirectories.push(directory);
		const modulePath = join(directory, "extension.ts");
		await writeFile(modulePath, "let count = 0; export default () => { count += 1; return count; };", "utf8");
		const loader = createNodeDynamicModuleLoader(import.meta.url);

		const first = await loader.importDefault(modulePath);
		const second = await loader.importDefault(modulePath);

		expect(typeof first).toBe("function");
		expect((first as () => number)()).toBe(1);
		expect((second as () => number)()).toBe(1);
	});

	it("provides virtual modules to loaded code", async () => {
		const directory = await mkdtemp(join(tmpdir(), "runtime-node-virtual-module-"));
		temporaryDirectories.push(directory);
		const modulePath = join(directory, "extension.ts");
		await writeFile(modulePath, 'import value from "virtual-value"; export default value;', "utf8");
		const loader = createNodeDynamicModuleLoader(import.meta.url, {
			virtualModules: { "virtual-value": { default: "injected" } },
		});

		await expect(loader.importDefault(modulePath)).resolves.toBe("injected");
	});

	it("owns Node URL and package resolution", () => {
		const fileUrl = pathToFileURL(import.meta.filename);
		expect(nodeFileUrlToPath(fileUrl)).toBe(import.meta.filename);
		expect(resolveNodeModuleSpecifier("@mariozechner/jiti", import.meta.url)).toContain("jiti");
	});
});
