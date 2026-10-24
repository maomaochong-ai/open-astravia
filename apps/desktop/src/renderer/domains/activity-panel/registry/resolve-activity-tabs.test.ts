import { describe, expect, it } from "vitest";
import {
	applyTabOrder,
	isPluginTabOnBar,
	resolveActivityTabs,
	resolveBuiltinTabPlacement,
	tabAttachKey,
} from "./resolve-activity-tabs";
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

describe("tabAttachKey", () => {
	it("strips plugin: prefix", () => {
		expect(tabAttachKey(def({ id: "plugin:git:changes", source: "plugin", pluginId: "git" }))).toBe("git:changes");
	});

	it("keeps the builtin tab id", () => {
		expect(tabAttachKey(def({ id: "browser", source: "builtin" }))).toBe("browser");
	});
});

describe("resolveBuiltinTabPlacement", () => {
	const browser = def({ id: "browser", source: "builtin", initiallyVisible: false });
	const files = def({ id: "file", source: "builtin" });

	it("puts initially-hidden builtins into the available pool", () => {
		expect(resolveBuiltinTabPlacement(browser, [], [])).toBe("available");
		expect(resolveBuiltinTabPlacement(files, [], [])).toBe("bar");
	});

	it("moves a builtin to the bar once it is explicitly attached", () => {
		expect(resolveBuiltinTabPlacement(browser, ["browser"], [])).toBe("bar");
	});

	it("keeps hiddenKeys authoritative over attach records", () => {
		expect(resolveBuiltinTabPlacement(browser, ["browser"], ["browser"])).toBe("hidden");
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

	it("puts initially-hidden panels into the available pool until attached", () => {
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
		expect(result.available.map((t) => t.id)).toEqual(["plugin:git:changes"]);

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
		expect(attached.available).toEqual([]);
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

	it("keeps the builtin browser off the bar until the user adds it", () => {
		const browser = def({ id: "browser", source: "builtin", order: 15, initiallyVisible: false });
		const metas = metaMap({ file: { label: "F" }, browser: { label: "Browser" } });

		const initial = resolveActivityTabs({
			definitions: [file, browser],
			metaById: metas,
			tabVisibilityRecords: [],
			hiddenKeys: [],
			tabOrder: [],
		});
		expect(initial.onBar.map((t) => t.id)).toEqual(["file"]);
		expect(initial.available.map((t) => t.id)).toEqual(["browser"]);

		const added = resolveActivityTabs({
			definitions: [file, browser],
			metaById: metas,
			tabVisibilityRecords: ["browser"],
			hiddenKeys: [],
			tabOrder: [],
		});
		expect(added.onBar.map((t) => t.id)).toEqual(["file", "browser"]);
		expect(added.available).toEqual([]);

		const thenHidden = resolveActivityTabs({
			definitions: [file, browser],
			metaById: metas,
			tabVisibilityRecords: ["browser"],
			hiddenKeys: ["browser"],
			tabOrder: [],
		});
		expect(thenHidden.restorable.map((t) => t.id)).toEqual(["browser"]);
	});
});
