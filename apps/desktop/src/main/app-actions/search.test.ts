import { describe, expect, it } from "vitest";
import { searchActions } from "./search.js";
import type { ActionDefinition, JsonValue } from "./types.js";

function action(id: string, title: string, overrides: Partial<ActionDefinition> = {}): ActionDefinition {
	return {
		id,
		domain: id.split(".")[0],
		title,
		summary: title,
		availability: "gui-renderer",
		permission: "plugin.vetta-actions.app-action.write",
		inputSchema: { description: "Object input" },
		examples: [],
		validateInput: () => ({}),
		run: () => ({}),
		...overrides,
	};
}

describe("App Action discovery", () => {
	it("does not match unrelated actions through shared plugin permissions", () => {
		const actions = [action("plugins.manage", "安装插件"), action("appearance.theme", "修改外观")];
		expect(searchActions(actions, { query: "安装插件" }).map(({ id }) => id)).toEqual(["plugins.manage"]);
	});

	it("returns usage boundaries without indexing exclusions as positive matches", () => {
		const usage = {
			target: "Vetta Desktop appearance settings",
			useWhen: "Change Vetta's own theme.",
			avoidWhen: "Installing webpack plugins or editing a website.",
			alternatives: "Use the project's package manager and source files.",
		};
		const theme = { ...action("appearance.theme", "修改外观"), usage };
		expect(searchActions([theme], { query: "appearance" })[0]).toMatchObject({ usage });
		expect(searchActions([theme], { query: "webpack" })).toEqual([]);
	});

	it("discovers exact action ids and keeps explicit domain filters", () => {
		const actions = [action("projects.manage", "管理项目"), action("batch-tasks.project", "管理批量项目")];
		expect(searchActions(actions, { query: "projects.manage" })[0]?.id).toBe("projects.manage");
		expect(searchActions(actions, { query: "项目", domain: "projects" }).map(({ id }) => id)).toEqual([
			"projects.manage",
		]);
		expect(searchActions(actions).map(({ id }) => id)).toEqual(["batch-tasks.project", "projects.manage"]);
	});

	it.each<JsonValue>([
		{ oneOf: [{ properties: { operation: { const: "install-from-path" } } }] },
		{ anyOf: [{ properties: { operation: { enum: ["install-from-path", "uninstall"] } } }] },
		{ allOf: [{ oneOf: [{ properties: { type: { const: "install-from-path" } } }] }] },
		{ properties: { type: { enum: ["install-from-path"] } } },
	])("can discover an operation documented only in a plugin JSON Schema: %j", (jsonSchema) => {
		const actions = [
			action("plugins.manage", "管理插件", {
				inputSchema: {
					description: "Manage installed extensions",
					jsonSchema,
				},
			}),
		];
		expect(searchActions(actions, { query: "install-from-path" }).map(({ id }) => id)).toEqual(["plugins.manage"]);
	});

	it("does not treat arbitrary schema descriptions or data enums as operation names", () => {
		const actions = [
			action("appearance.theme", "修改外观", {
				inputSchema: {
					description: "Appearance",
					jsonSchema: {
						description: "webpack",
						properties: { label: { enum: ["webpack"] } },
					},
				},
			}),
		];
		expect(searchActions(actions, { query: "webpack" })).toEqual([]);
	});
});
