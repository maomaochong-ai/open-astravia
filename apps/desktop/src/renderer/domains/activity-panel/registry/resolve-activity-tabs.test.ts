import { describe, expect, it } from "vitest";
import { applyTabOrder, isPluginTabOnBar, pluginAttachKey, resolveActivityTabs } from "./resolve-activity-tabs";
import type { ActivityTabDefinition, ActivityTabMeta } from "./types";

function def(
	partial: Partial<ActivityTabDefinition> & Pick<ActivityTabDefinition, "id" | "source">,
): ActivityTabDefinition {
	return {
		useMeta: () => ({ label: partial.id }),
		component: () => null,
		...partial,
	};
}

function metaMap(entries: Record<string, ActivityTabMeta | null>): Map<string, ActivityTabMeta | null> {
	return new Map(Object.entries(entries));
}

describe("applyTabOrder", () => {
	it("keeps natural order when order list is empty", () => {
		const items = [{ id: "a" }, { id: "b" }];
		expect(applyTabOrder(items, []).map((i) => i.id)).toEqual(["a", "b"]);
	});

	it("sorts by order list and appends unknowns in natural order", () => {
		const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
		expect(applyTabOrder(items, ["c", "a"]).map((i) => i.id)).toEqual(["c", "a", "b"]);
	});
});

describe("pluginAttachKey", () => {
	it("strips plugin: prefix", () => {
		expect(pluginAttachKey(def({ id: "plugin:git:changes", source: "plugin", pluginId: "git" }))).toBe("git:changes");
	});
});

describe("isPluginTabOnBar", () => {
	const tab = def({
		id: "plugin:git:changes",
		source: "plugin",
		pluginId: "git",
		initiallyVisible: true,
	});

	it("defaults to initiallyVisible when no record", () => {
		expect(isPluginTabOnBar(tab, [])).toBe(true);
		expect(isPluginTabOnBar({ ...tab, initiallyVisible: false }, [])).toBe(false);
	});

	it("honors explicit attach / detach records", () => {
		expect(isPluginTabOnBar(tab, ["git:changes"])).toBe(true);
		expect(isPluginTabOnBar(tab, ["-git:changes"])).toBe(false);
	});
});

describe("resolveActivityTabs", () => {
	const file = def({ id: "file", source: "builtin", order: 0, removable: false });
	const todo = def({ id: "todo", source: "builtin", order: 20 });
	const plugin = def({
		id: "plugin:git:changes",
		source: "plugin",
		pluginId: "git",
		pluginName: "Git",
		order: 50,
		initiallyVisible: false,
	});

	it("drops tabs whose meta is null", () => {
		const result = resolveActivityTabs({
			definitions: [file, todo],
			metaById: metaMap({ file: { label: "Files" }, todo: null }),
			tabVisibilityRecords: [],
			hiddenKeys: [],
			tabOrder: [],
		});
		expect(result.candidates.map((t) => t.id)).toEqual(["file"]);
		expect(result.onBar.map((t) => t.id)).toEqual(["file"]);
	});

	it("splits builtin hidden into restorable", () => {
		const result = resolveActivityTabs({
			definitions: [file, todo],
			metaById: metaMap({
				file: { label: "Files" },
				todo: { label: "Todo", badge: 2 },
			}),
			tabVisibilityRecords: [],
			hiddenKeys: ["todo"],
			tabOrder: [],
		});
		expect(result.onBar.map((t) => t.id)).toEqual(["file"]);
		expect(result.restorable.map((t) => t.id)).toEqual(["todo"]);
		expect(result.restorable[0]?.badge).toBe(2);
	});

	it("puts initially-hidden plugins into availablePlugins until attached", () => {
		const result = resolveActivityTabs({
			definitions: [file, plugin],
			metaById: metaMap({
				file: { label: "Files" },
				"plugin:git:changes": { label: "Changes" },
			}),
			tabVisibilityRecords: [],
			hiddenKeys: [],
			tabOrder: [],
		});
		expect(result.onBar.map((t) => t.id)).toEqual(["file"]);
		expect(result.availablePlugins.map((t) => t.id)).toEqual(["plugin:git:changes"]);

		const attached = resolveActivityTabs({
			definitions: [file, plugin],
			metaById: metaMap({
				file: { label: "Files" },
				"plugin:git:changes": { label: "Changes" },
			}),
			tabVisibilityRecords: ["git:changes"],
			hiddenKeys: [],
			tabOrder: ["plugin:git:changes", "file"],
		});
		expect(attached.onBar.map((t) => t.id)).toEqual(["plugin:git:changes", "file"]);
		expect(attached.availablePlugins).toEqual([]);
	});

	it("sorts by definition.order then user tabOrder", () => {
		const late = def({ id: "debug", source: "builtin", order: 90 });
		const result = resolveActivityTabs({
			definitions: [late, file, todo],
			metaById: metaMap({
				file: { label: "F" },
				todo: { label: "T" },
				debug: { label: "D" },
			}),
			tabVisibilityRecords: [],
			hiddenKeys: [],
			tabOrder: ["todo", "file"],
		});
		// natural by order: file(0), todo(20), debug(90) → user order reorders onBar
		expect(result.onBar.map((t) => t.id)).toEqual(["todo", "file", "debug"]);
	});
});
