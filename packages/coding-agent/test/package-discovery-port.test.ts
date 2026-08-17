import path from "node:path";
import { describe, expect, it } from "vitest";
import type {
	ResourceAccessPort,
	ResourceDirectoryEntry,
	ResourceFileInfo,
} from "../src/resources/contracts/resource-access.js";
import {
	collectAutoPromptEntries,
	collectResourceFiles,
	readResourceManifest,
} from "../src/resources/packages/resource-discovery.js";

describe("Resource Package discovery host port", () => {
	it("discovers package resources through ResourceAccessPort and keeps ignore rules", async () => {
		const access = createMemoryResourceAccess(
			new Map([
				["/pkg/extensions/index.ts", "export default {}"],
				["/pkg/extensions/helper.ts", "export const helper = true"],
				["/pkg/extensions/.gitignore", "helper.ts\n"],
				["/pkg/prompts/review.md", "Review"],
				["/pkg/themes/dark.json", "{}"],
			]),
		);

		await expect(collectResourceFiles({ resourceAccess: access }, "/pkg/extensions", "extensions")).resolves.toEqual([
			"/pkg/extensions/index.ts",
		]);
		await expect(collectResourceFiles({ resourceAccess: access }, "/pkg/themes", "themes")).resolves.toEqual([
			"/pkg/themes/dark.json",
		]);
		await expect(collectAutoPromptEntries({ resourceAccess: access }, "/pkg/prompts")).resolves.toEqual([
			"/pkg/prompts/review.md",
		]);
	});

	it("parses manifest content without reading the host filesystem directly", async () => {
		const access = createMemoryResourceAccess(
			new Map([["/pkg/package.json", JSON.stringify({ pi: { extensions: ["extensions"] } })]]),
		);

		await expect(readResourceManifest({ resourceAccess: access }, "/pkg")).resolves.toEqual({
			extensions: ["extensions"],
		});
	});

	it("propagates cancellation instead of treating it as a missing directory", async () => {
		const controller = new AbortController();
		controller.abort(new DOMException("cancelled", "AbortError"));

		await expect(
			collectAutoPromptEntries(
				{ resourceAccess: createMemoryResourceAccess(new Map()), signal: controller.signal },
				"/pkg",
			),
		).rejects.toMatchObject({ name: "AbortError" });
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
		if (content !== undefined) return { kind: "file", modifiedAtMs: 0, size: content.length };
		return directories().has(normalized) ? { kind: "directory", modifiedAtMs: 0, size: 0 } : undefined;
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
				if (content === undefined) throw Object.assign(new Error("missing file"), { code: "ENOENT" });
				return content;
			},
			async readDirectory(resourcePath, options) {
				options?.signal?.throwIfAborted();
				const directory = normalize(resourcePath);
				const entries = new Map<string, ResourceDirectoryEntry>();
				for (const file of files.keys()) {
					const relative = path.posix.relative(directory, normalize(file));
					if (!relative || relative.startsWith("../")) continue;
					const name = relative.split("/")[0];
					const child = path.posix.join(directory, name);
					entries.set(name, { name, kind: stat(child)?.kind ?? "other", symbolicLink: false });
				}
				return [...entries.values()];
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
			join: (...parts) => path.posix.join(...parts),
			relative: path.posix.relative,
			resolve: (...parts) => path.posix.resolve(...parts),
		},
	};
}
