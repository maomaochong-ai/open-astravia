import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveTeamWorkspacePath } from "./team-workspace.js";

describe("resolveTeamWorkspacePath", () => {
	it("keeps arbitrary Team ids inside the Team workspace root", () => {
		const root = resolve("C:/vetta-home");
		const path = resolveTeamWorkspacePath("../outside/团队", root);
		const relativePath = relative(resolve(root, "agent-teams"), path);

		expect(relativePath.startsWith("..")).toBe(false);
		expect(relativePath.endsWith("workspace")).toBe(true);
	});

	it("maps the same Team id to one stable shared path", () => {
		const root = resolve("C:/vetta-home");
		expect(resolveTeamWorkspacePath("team-a", root)).toBe(resolveTeamWorkspacePath("team-a", root));
		expect(resolveTeamWorkspacePath("team-a", root)).not.toBe(resolveTeamWorkspacePath("team-b", root));
	});
});
