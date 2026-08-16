import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import type { ResourceAccessPort, ResourceDirectoryEntry } from "../src/resources/contracts/resource-access.js";
import type { ThemeResourceParser } from "../src/resources/contracts/resource-runtime.js";
import { loadThemeResources } from "../src/resources/runtime/theme-resources.js";

describe("theme resource access port", () => {
	it("loads files and symbolic links through the injected resource tree", async () => {
		const access = createMemoryResourceAccess({
			files: new Map([
				["/workspace/themes/project.json", "shared"],
				["/workspace/themes/invalid.json", "invalid"],
				["/workspace/shared/linked.json", "linked"],
				["/workspace/standalone.json", "shared"],
				["/workspace/README.md", "ignored"],
			]),
			directories: new Map([
				[
					"/workspace/themes",
					[
						{ name: "project.json", kind: "file", symbolicLink: false },
						{ name: "linked.json", kind: "other", symbolicLink: true },
						{ name: "invalid.json", kind: "file", symbolicLink: false },
						{ name: "notes.txt", kind: "file", symbolicLink: false },
						{ name: "nested", kind: "directory", symbolicLink: false },
					],
				],
			]),
			symbolicLinks: new Map([["/workspace/themes/linked.json", "/workspace/shared/linked.json"]]),
		});
		const parsedPaths: string[] = [];
		const parse: ThemeResourceParser = (path, content) => {
			parsedPaths.push(path);
			if (content === "invalid") throw new Error("invalid theme document");
			return { name: content, sourcePath: path } as unknown as ReturnType<ThemeResourceParser>;
		};

		const result = await loadThemeResources({
			resourceAccess: access,
			cwd: "/workspace",
			paths: ["themes", "standalone.json", "missing.json", "README.md"],
			parse,
		});

		expect(result.themes.map((theme) => [theme.name, theme.sourcePath])).toEqual([
			["shared", "/workspace/themes/project.json"],
			["linked", "/workspace/themes/linked.json"],
		]);
		expect(parsedPaths).toEqual([
			"/workspace/themes/project.json",
			"/workspace/themes/linked.json",
			"/workspace/themes/invalid.json",
			"/workspace/standalone.json",
		]);
		expect(result.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "warning", message: "invalid theme document" }),
				expect.objectContaining({
					type: "collision",
					path: "/workspace/standalone.json",
					collision: expect.objectContaining({
						winnerPath: "/workspace/themes/project.json",
						loserPath: "/workspace/standalone.json",
					}),
				}),
				expect.objectContaining({
					type: "warning",
					message: "theme path does not exist",
					path: "/workspace/missing.json",
				}),
				expect.objectContaining({
					type: "warning",
					message: "theme path is not a json file",
					path: "/workspace/README.md",
				}),
			]),
		);
	});

	it("propagates cancellation instead of converting it to a diagnostic", async () => {
		const controller = new AbortController();
		controller.abort(new Error("theme loading cancelled"));

		await expect(
			loadThemeResources({
				resourceAccess: createMemoryResourceAccess({ files: new Map() }),
				cwd: "/workspace",
				paths: ["theme.json"],
				parse: (() => {
					throw new Error("parser must not run");
				}) as ThemeResourceParser,
				signal: controller.signal,
			}),
		).rejects.toThrow("theme loading cancelled");
	});
});

interface MemoryResourceTree {
	readonly files: Map<string, string>;
	readonly directories?: Map<string, readonly ResourceDirectoryEntry[]>;
	readonly symbolicLinks?: Map<string, string>;
}

function createMemoryResourceAccess(tree: MemoryResourceTree): ResourceAccessPort {
	const directories = tree.directories ?? new Map();
	const symbolicLinks = tree.symbolicLinks ?? new Map();
	const resolveLink = (path: string): string => symbolicLinks.get(path) ?? path;
	return {
		files: {
			async stat(path, options) {
				options?.signal?.throwIfAborted();
				const resolved = resolveLink(path);
				if (tree.files.has(resolved))
					return { kind: "file", modifiedAtMs: 0, size: tree.files.get(resolved)?.length ?? 0 };
				if (directories.has(resolved)) return { kind: "directory", modifiedAtMs: 0, size: 0 };
				return undefined;
			},
			async readText(path, options) {
				options?.signal?.throwIfAborted();
				const content = tree.files.get(resolveLink(path));
				if (content === undefined) throw new Error(`missing file: ${path}`);
				return content;
			},
			async readDirectory(path, options) {
				options?.signal?.throwIfAborted();
				const entries = directories.get(resolveLink(path));
				if (!entries) throw new Error(`missing directory: ${path}`);
				return entries;
			},
			async realPath(path, options) {
				options?.signal?.throwIfAborted();
				return resolveLink(path);
			},
		},
		paths: {
			separator: posix.sep,
			homeDirectory: () => "/home/test",
			basename: posix.basename,
			dirname: posix.dirname,
			isAbsolute: posix.isAbsolute,
			join: posix.join,
			relative: posix.relative,
			resolve: posix.resolve,
		},
	};
}
