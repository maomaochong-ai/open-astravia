import path from "node:path";
import { describe, expect, it } from "vitest";
import type {
	ResourceAccessPort,
	ResourceDirectoryEntry,
	ResourceFileInfo,
} from "../src/resources/contracts/resource-access.js";
import { loadSkills } from "../src/resources/skills/index.js";

describe("Skill discovery ResourceAccessPort", () => {
	it("materializes ordered Skill and Scene content without host filesystem access", async () => {
		const files = new Map([
			["/agent/skills/user/SKILL.md", skillDocument("user", "User body")],
			["/workspace/.vetta/skills/project/SKILL.md", skillDocument("project", "Project body")],
			["/scene/deploy/SKILL.md", skillDocument("deploy", "Deploy body")],
			["/scene/deploy/tasks.json", JSON.stringify(["prepare", "publish"])],
			["/workspace/.agents/skills/generic/SKILL.md", skillDocument("generic", "Generic body")],
		]);
		const resourceAccess = createMemoryResourceAccess(files);

		const result = await loadSkills({
			resourceAccess,
			cwd: "/workspace",
			agentDir: "/agent",
			sceneDir: "/scene",
			includeAgentSkills: true,
		});

		expect(result.skills.map(({ name, source }) => [name, source])).toEqual([
			["user", "user"],
			["project", "project"],
			["deploy", "scene"],
			["generic", "agents-project"],
		]);
		const scene = result.skills.find(({ name }) => name === "deploy");
		expect(scene).toMatchObject({
			content: expect.stringContaining("Deploy body"),
			sceneTasks: ["prepare", "publish"],
		});

		files.set("/scene/deploy/SKILL.md", skillDocument("deploy", "Changed after materialization"));
		expect(scene?.content).toContain("Deploy body");
		expect(scene?.content).not.toContain("Changed after materialization");
	});

	it("propagates cancellation instead of converting it into a diagnostic", async () => {
		const controller = new AbortController();
		controller.abort(new DOMException("cancelled", "AbortError"));

		await expect(
			loadSkills({
				resourceAccess: createMemoryResourceAccess(new Map()),
				cwd: "/workspace",
				agentDir: "/agent",
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
	});
});

function skillDocument(name: string, body: string): string {
	return `---\nname: ${name}\ndescription: ${name} description\n---\n${body}\n`;
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
