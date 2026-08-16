import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ResourcePathPort } from "../src/resources/contracts/resource-access.js";
import { applyResourcePatterns, isResourceEnabledByOverrides } from "../src/resources/packages/resource-patterns.js";
import {
	mergeResourcePaths,
	ResourceMetadataIndex,
	resolveResourcePath,
} from "../src/resources/runtime/resource-state.js";

const paths: ResourcePathPort = {
	separator: path.posix.sep,
	homeDirectory: () => "/home/test",
	basename: path.posix.basename,
	dirname: path.posix.dirname,
	isAbsolute: path.posix.isAbsolute,
	join: path.posix.join,
	relative: path.posix.relative,
	resolve: path.posix.resolve,
};

describe("resource path host contract", () => {
	it("resolves workspace and home paths without ambient process state", () => {
		expect(resolveResourcePath(paths, "/workspace/project", " ./skills ")).toBe("/workspace/project/skills");
		expect(resolveResourcePath(paths, "/workspace/project", "~/shared")).toBe("/home/test/shared");
		expect(resolveResourcePath(paths, "/workspace/project", "~other")).toBe("/home/test/other");
		expect(mergeResourcePaths(paths, "/workspace", ["skills", "~/shared"], ["./skills"])).toEqual([
			"/workspace/skills",
			"/home/test/shared",
		]);
	});

	it("keeps Skill parent-directory pattern semantics", () => {
		const baseDir = "/workspace/.vetta/skills";
		const alpha = `${baseDir}/alpha/SKILL.md`;
		const beta = `${baseDir}/beta/SKILL.md`;

		expect(applyResourcePatterns(paths, [alpha, beta], ["!*/SKILL.md", "+alpha", "-beta"], baseDir)).toEqual(
			new Set([alpha]),
		);
		expect(isResourceEnabledByOverrides(paths, alpha, ["!*/SKILL.md", "+alpha"], baseDir)).toBe(true);
		expect(isResourceEnabledByOverrides(paths, beta, ["-beta"], baseDir)).toBe(false);
	});

	it("attributes metadata using the injected workspace path semantics", () => {
		const index = new ResourceMetadataIndex(paths, "/workspace/project", "/agent");
		index.addDefault("/workspace/project/.vetta/skills/review/SKILL.md");
		index.addDefault("/agent/prompts/review.md");
		index.apply(
			[
				{
					path: "extensions/custom",
					metadata: { source: "extension", scope: "temporary", origin: "top-level" },
				},
			],
			["/workspace/project/extensions/custom/prompts/review.md"],
		);

		expect(index.get().get("/workspace/project/.vetta/skills/review/SKILL.md")).toMatchObject({
			scope: "project",
		});
		expect(index.get().get("/agent/prompts/review.md")).toMatchObject({ scope: "user" });
		expect(index.get().get("/workspace/project/extensions/custom/prompts/review.md")).toEqual({
			source: "extension",
			scope: "temporary",
			origin: "top-level",
		});
	});
});
