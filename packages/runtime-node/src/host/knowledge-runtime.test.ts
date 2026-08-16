import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WritePageRequest } from "@vetta/runtime-knowledge";
import { afterEach, describe, expect, it } from "vitest";
import { createNodeKnowledgeRuntime } from "./knowledge-runtime.js";

describe("NodeKnowledgeRuntime", () => {
	const directories: string[] = [];

	afterEach(async () => {
		for (const directory of directories.splice(0).reverse()) {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("binds knowledge query and write operations to one explicit root", async () => {
		const root = await mkdtemp(join(tmpdir(), "node-knowledge-runtime-"));
		directories.push(root);
		const runtime = createNodeKnowledgeRuntime(root);
		const request: WritePageRequest = {
			path: "guides/runtime.md",
			source: "manual",
			source_path: "manual/runtime.md",
			source_hash: "runtime-hash",
			tags: ["runtime", "guide"],
			title: "Runtime Guide",
			summary: "Runtime setup",
			body: "# Runtime",
		};

		const result = await runtime.write.write(request, "2026-08-16T00:00:00.000Z");
		const [tags, pages] = await Promise.all([
			runtime.query.listAvailableTags(),
			runtime.query.queryByTags({ all: ["runtime"] }),
		]);

		expect(result.action).toBe("create");
		expect(tags).toEqual([
			{ tag: "guide", count: 1 },
			{ tag: "runtime", count: 1 },
		]);
		expect(pages).toHaveLength(1);
		expect(pages[0]).toMatchObject({
			path: "guides/runtime.md",
			title: "Runtime Guide",
			absolutePath: runtime.write.resolveAbsolutePath("guides/runtime.md"),
		});
	});
});
