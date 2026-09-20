import type { PluginFsApi } from "@vetta-org/plugin-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { appendToGitignore } from "../src/git/ignore";
import { setFsApi } from "../src/git/runtime";

/** In-memory stand-in for the host fs API, holding one file. */
function fakeFs(initial: string | null): { api: PluginFsApi; read: () => string | null } {
	let content = initial;
	const api = {
		readFile: async (path: string) => {
			if (path !== "/repo/.gitignore" || content === null) throw new Error("ENOENT");
			return { content, encoding: "utf8" as const };
		},
		writeFile: async (_path: string, next: string) => {
			content = next;
		},
	} as unknown as PluginFsApi;
	return { api, read: () => content };
}

describe("appendToGitignore", () => {
	let fs: ReturnType<typeof fakeFs>;

	const install = (initial: string | null): void => {
		fs = fakeFs(initial);
		setFsApi(fs.api);
	};

	beforeEach(() => install(null));

	it("creates the file with root-anchored patterns", async () => {
		await appendToGitignore("/repo", ["dist/bundle.js"]);

		expect(fs.read()).toBe("/dist/bundle.js\n");
	});

	it("appends without disturbing existing lines", async () => {
		install("node_modules\n*.log\n");

		await appendToGitignore("/repo", ["tmp/scratch.txt"]);

		expect(fs.read()).toBe("node_modules\n*.log\n/tmp/scratch.txt\n");
	});

	it("adds the missing trailing newline before appending", async () => {
		install("node_modules");

		await appendToGitignore("/repo", ["a.txt"]);

		expect(fs.read()).toBe("node_modules\n/a.txt\n");
	});

	it("skips patterns the file already lists and writes nothing when all are present", async () => {
		install("/a.txt\n");

		await appendToGitignore("/repo", ["a.txt"]);

		expect(fs.read()).toBe("/a.txt\n");
	});

	it("deduplicates repeated paths within one call", async () => {
		await appendToGitignore("/repo", ["a.txt", "a.txt", "b.txt"]);

		expect(fs.read()).toBe("/a.txt\n/b.txt\n");
	});
});
