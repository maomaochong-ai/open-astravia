import path from "node:path";
import { describe, expect, it } from "vitest";
import type {
	ResourceAccessPort,
	ResourceDirectoryEntry,
	ResourceFileInfo,
} from "../src/resources/contracts/resource-access.js";
import { loadPromptTemplates } from "../src/resources/prompts/index.js";
import { loadPromptResources } from "../src/resources/runtime/prompt-resource-state.js";

describe("Prompt template ResourceAccessPort", () => {
	it("materializes templates in user, project, then explicit source order", async () => {
		const files = new Map([
			["/agent/prompts/review.md", promptDocument("Review changes", "User body")],
			["/workspace/.vetta/prompts/plan.md", "Project body"],
			["/extra/deploy.md", promptDocument("Deploy safely", "Deploy $ARGUMENTS")],
		]);

		const templates = await loadPromptTemplates({
			resourceAccess: createMemoryResourceAccess(files),
			cwd: "/workspace",
			agentDir: "/agent",
			promptPaths: ["/extra"],
		});

		expect(templates.map(({ name, source }) => [name, source])).toEqual([
			["review", "user"],
			["plan", "project"],
			["deploy", "path"],
		]);
		expect(templates[0]).toMatchObject({
			description: "Review changes (user)",
			content: "User body",
		});
		expect(templates[1]?.description).toBe("Project body (project)");
		expect(templates[2]?.description).toBe("Deploy safely (path:extra)");

		files.set("/agent/prompts/review.md", promptDocument("Changed", "Changed body"));
		expect(templates[0]?.content).toBe("User body");
	});

	it("keeps the first prompt on collision and reports the losing path", async () => {
		const files = new Map([
			["/agent/prompts/shared.md", "User winner"],
			["/workspace/.vetta/prompts/shared.md", "Project loser"],
		]);

		const result = await loadPromptResources({
			resourceAccess: createMemoryResourceAccess(files),
			cwd: "/workspace",
			agentDir: "/agent",
			paths: ["/agent/prompts", "/workspace/.vetta/prompts"],
			disabled: false,
		});

		expect(result.prompts).toHaveLength(1);
		expect(result.prompts[0]?.content).toBe("User winner");
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({
				type: "collision",
				path: "/workspace/.vetta/prompts/shared.md",
				collision: expect.objectContaining({
					winnerPath: "/agent/prompts/shared.md",
					loserPath: "/workspace/.vetta/prompts/shared.md",
				}),
			}),
		);
	});

	it("propagates cancellation instead of treating it as a missing resource", async () => {
		const controller = new AbortController();
		controller.abort(new DOMException("cancelled", "AbortError"));

		await expect(
			loadPromptTemplates({
				resourceAccess: createMemoryResourceAccess(new Map()),
				cwd: "/workspace",
				agentDir: "/agent",
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
	});
});

function promptDocument(description: string, body: string): string {
	return `---\ndescription: ${description}\n---\n${body}`;
}

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
				if (content === undefined) throw Object.assign(new Error("missing file"), { code: "ENOENT" });
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
