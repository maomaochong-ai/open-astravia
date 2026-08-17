import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionCommandContext, ExtensionFactory } from "../src/extensions/index.js";
import { discoverExtensionPaths } from "../src/extensions/runtime/discovery/extension-paths.js";
import { loadExtensions } from "../src/extensions/runtime/loading/load-extensions.js";
import type {
	ResourceAccessPort,
	ResourceDirectoryEntry,
	ResourceFileInfo,
} from "../src/resources/contracts/resource-access.js";

describe("Extension host ports", () => {
	it("discovers project, user, and configured Extensions through an in-memory file tree", async () => {
		const files = new Map([
			["/workspace/.vetta/extensions/project.ts", "project"],
			["/agent/extensions/user/index.js", "user"],
			["/extra/package.json", JSON.stringify({ pi: { extensions: ["./src/first.ts", "./src/missing.ts"] } })],
			["/extra/src/first.ts", "extra"],
		]);

		await expect(
			discoverExtensionPaths({
				resourceAccess: createMemoryResourceAccess(files),
				configuredPaths: ["/extra"],
				cwd: "/workspace",
				agentDir: "/agent",
			}),
		).resolves.toEqual([
			"/workspace/.vetta/extensions/project.ts",
			"/agent/extensions/user/index.js",
			"/extra/src/first.ts",
		]);
	});

	it("loads and executes an Extension using only injected Factory and command ports", async () => {
		const execute = vi.fn(async () => ({ stdout: "done", stderr: "", code: 0, killed: false }));
		const factory: ExtensionFactory = (api) => {
			api.registerCommand("run", {
				async handler(_args, context) {
					await api.exec("tool", ["arg"], { cwd: context.cwd });
				},
			});
		};
		const loadFactory = vi.fn(async () => factory);
		const resourceAccess = createMemoryResourceAccess(new Map([["/extensions/test.ts", "module"]]));

		const result = await loadExtensions(["/extensions/test.ts"], {
			cwd: "/workspace",
			resourceAccess,
			factoryLoader: { loadFactory },
			commandExecutor: { execute },
		});
		const command = result.extensions[0]?.commands.get("run");
		if (!command) throw new Error("Missing registered command");
		await command.handler("", { cwd: "/command-workspace" } as ExtensionCommandContext);

		expect(loadFactory).toHaveBeenCalledWith("/extensions/test.ts", "native", { signal: undefined });
		expect(execute).toHaveBeenCalledWith("tool", ["arg"], "/command-workspace", {
			cwd: "/command-workspace",
		});
	});

	it("propagates cancellation before discovery or module execution", async () => {
		const controller = new AbortController();
		controller.abort(new DOMException("cancelled", "AbortError"));
		const loadFactory = vi.fn();

		await expect(
			loadExtensions(["/extensions/test.ts"], {
				cwd: "/workspace",
				resourceAccess: createMemoryResourceAccess(new Map()),
				factoryLoader: { loadFactory },
				commandExecutor: { execute: vi.fn() },
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(loadFactory).not.toHaveBeenCalled();
	});
});

function createMemoryResourceAccess(files: Map<string, string>): ResourceAccessPort {
	const normalize = (value: string): string => path.posix.resolve("/", value);
	const directories = (): Set<string> => {
		const result = new Set(["/"]);
		for (const file of files.keys()) {
			let directory = path.posix.dirname(normalize(file));
			while (!result.has(directory)) {
				result.add(directory);
				directory = path.posix.dirname(directory);
			}
		}
		return result;
	};
	const stat = (resourcePath: string): ResourceFileInfo | undefined => {
		const normalized = normalize(resourcePath);
		const content = files.get(normalized);
		if (content !== undefined) return { kind: "file", modifiedAtMs: 1, size: content.length };
		return directories().has(normalized) ? { kind: "directory", modifiedAtMs: 1, size: 0 } : undefined;
	};
	return {
		files: {
			async stat(resourcePath, options) {
				options?.signal?.throwIfAborted();
				return stat(resourcePath);
			},
			async readText(resourcePath, options) {
				options?.signal?.throwIfAborted();
				const content = files.get(normalize(resourcePath));
				if (content === undefined) throw new Error("missing file");
				return content;
			},
			async readDirectory(resourcePath, options) {
				options?.signal?.throwIfAborted();
				const directory = normalize(resourcePath);
				const names = new Map<string, ResourceDirectoryEntry>();
				for (const file of files.keys()) {
					const relative = path.posix.relative(directory, normalize(file));
					if (!relative || relative.startsWith("../")) continue;
					const name = relative.split("/")[0];
					if (!name) continue;
					const child = path.posix.join(directory, name);
					names.set(name, { name, kind: stat(child)?.kind ?? "other", symbolicLink: false });
				}
				return [...names.values()];
			},
			async realPath(resourcePath, options) {
				options?.signal?.throwIfAborted();
				return normalize(resourcePath);
			},
		},
		paths: {
			separator: "/",
			homeDirectory: () => "/home",
			basename: path.posix.basename,
			dirname: path.posix.dirname,
			isAbsolute: path.posix.isAbsolute,
			join: path.posix.join,
			relative: path.posix.relative,
			resolve: path.posix.resolve,
		},
	};
}
