import { describe, expect, it } from "vitest";
import type { CommandMenuEntry, CommandMenuGroupKey } from "../types";
import { buildCommandMenuGroups, type CommandMenuGroupLabels } from "./build-groups";

const labels: CommandMenuGroupLabels = {
	groups: {
		projects: "Projects",
		sessions: "Sessions",
		abilities: "Abilities",
		settings: "Settings",
		workspaceViews: "Workspace",
	},
	overflow: (count) => `${count} more`,
};

function entry(
	id: string,
	groupKey: CommandMenuGroupKey,
	title: string,
	overrides: Partial<CommandMenuEntry> = {},
): CommandMenuEntry {
	return {
		id,
		groupKey,
		title,
		icon: "icon-[solar--folder-linear]",
		order: 0,
		action: { kind: "openAbilities" },
		...overrides,
	};
}

describe("buildCommandMenuGroups", () => {
	it("emits groups in the constant order regardless of score", () => {
		// settings 条目分数更高（前缀命中），但它的组仍排在 projects/sessions 之后。
		const entries = [
			entry("st", "settings", "alpha"),
			entry("p", "projects", "an alpha project"),
			entry("s", "sessions", "an alpha session"),
		];
		const { groups } = buildCommandMenuGroups({ entries, tokens: ["alpha"], labels });

		expect(groups.map((group) => group.key)).toEqual(["projects", "sessions", "settings"]);
	});

	it("sorts within a group by score and falls back to the adapter order when tied", () => {
		const entries = [
			entry("mid", "projects", "my-alpha", { order: 0 }),
			entry("prefix", "projects", "alpha-tool", { order: 1 }),
			entry("tie-b", "projects", "alpha-two", { order: 3 }),
			entry("tie-a", "projects", "alpha-one", { order: 2 }),
		];
		const { groups } = buildCommandMenuGroups({ entries, tokens: ["alpha"], labels });

		// 三个前缀命中同分，按 order 稳定排列；词首命中的 my-alpha 落到最后。
		expect(groups[0].items.map((item) => item.id)).toEqual(["prefix", "tie-a", "tie-b", "mid"]);
	});

	it("caps each group and reports the hidden count", () => {
		const entries = Array.from({ length: 9 }, (_, index) =>
			entry(`p${index}`, "projects", `alpha-${index}`, { order: index }),
		);
		const { groups, orderedIds } = buildCommandMenuGroups({ entries, tokens: ["alpha"], labels, limit: 6 });

		expect(groups[0].items).toHaveLength(6);
		expect(groups[0].overflowLabel).toBe("3 more");
		expect(orderedIds).toHaveLength(6);
	});

	it("drops groups with no matches but keeps a loading group with no items", () => {
		const entries = [entry("p", "projects", "alpha")];
		const { groups } = buildCommandMenuGroups({
			entries,
			tokens: ["alpha"],
			labels,
			loadingGroups: ["sessions"],
		});

		expect(groups.map((group) => group.key)).toEqual(["projects", "sessions"]);
		expect(groups[1].items).toEqual([]);
		expect(groups[1].loading).toBe(true);
	});

	it("keeps a pinned-to-bottom entry out of matching and always last in its group", () => {
		const entries = [
			entry("a1", "abilities", "alpha skill"),
			entry("escape", "abilities", "Search the marketplace", {
				pinnedToBottom: true,
				order: Number.MAX_SAFE_INTEGER,
			}),
		];

		const matched = buildCommandMenuGroups({ entries, tokens: ["alpha"], labels });
		expect(matched.groups[0].items.map((item) => item.id)).toEqual(["a1", "escape"]);

		// 查询与任何已装能力都不匹配时，逃生行仍然在场——这正是它存在的意义。
		const unmatched = buildCommandMenuGroups({ entries, tokens: ["zzz"], labels });
		expect(unmatched.groups.map((group) => group.key)).toEqual(["abilities"]);
		expect(unmatched.groups[0].items.map((item) => item.id)).toEqual(["escape"]);
	});

	it("returns every entry when the query has no tokens", () => {
		const entries = [entry("p1", "projects", "alpha"), entry("p2", "projects", "beta")];
		const { groups } = buildCommandMenuGroups({ entries, tokens: [], labels });
		expect(groups[0].items.map((item) => item.id)).toEqual(["p1", "p2"]);
	});

	it("excludes disabled rows from keyboard navigation while still rendering them", () => {
		const entries = [
			entry("ok", "sessions", "alpha one", { order: 0 }),
			entry("locked", "sessions", "alpha two", { order: 1, disabled: true, disabledReason: "No access" }),
		];
		const { groups, orderedIds } = buildCommandMenuGroups({ entries, tokens: ["alpha"], labels });

		expect(groups[0].items.map((item) => item.id)).toEqual(["ok", "locked"]);
		expect(orderedIds).toEqual(["ok"]);
	});

	it("indexes entries by id so the model can resolve an activation without a scan", () => {
		const entries = [entry("p1", "projects", "alpha", { action: { kind: "openProject", cwd: "/w/a" } })];
		const { entryById } = buildCommandMenuGroups({ entries, tokens: ["alpha"], labels });

		expect(entryById.get("p1")?.action).toEqual({ kind: "openProject", cwd: "/w/a" });
	});

	it("carries merged highlight ranges through to the rendered item", () => {
		const entries = [entry("p1", "projects", "openvetta")];
		const { groups } = buildCommandMenuGroups({ entries, tokens: ["open", "vetta"], labels });

		expect(groups[0].items[0].titleHighlights).toEqual([{ start: 0, end: 9 }]);
	});
});
