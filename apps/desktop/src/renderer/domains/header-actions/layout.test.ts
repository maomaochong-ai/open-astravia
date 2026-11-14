import { describe, expect, it } from "vitest";
import { DEFAULT_TOP_ACTIONS, MAX_TOP_ACTIONS, moveHeaderAction, resolveHeaderLayout } from "./layout";

const keys = (count: number, prefix = "k") => Array.from({ length: count }, (_, index) => `${prefix}${index}`);

describe("resolveHeaderLayout", () => {
	it("uses the default order when nothing is saved", () => {
		expect(resolveHeaderLayout(["a", "b", "c"], null)).toEqual({ top: ["a", "b", "c"], tray: [] });
	});

	it("stows what does not fit in the cap, last ones first", () => {
		const layout = resolveHeaderLayout(keys(9), null);
		expect(layout.top).toEqual(keys(7));
		expect(layout.tray).toEqual(["k7", "k8"]);
		expect(MAX_TOP_ACTIONS).toBe(7);
	});

	it("keeps the saved order and never lets a new action displace it", () => {
		const layout = resolveHeaderLayout(["new", "a", "b"], { top: ["b", "a"], tray: [] });
		// 顶栏有空位：新动作按默认顺序插进去（默认里 new 排第一，插在第一个默认序更靠后的项之前）。
		expect(layout.top).toEqual(["new", "b", "a"]);
	});

	it("sends a new action to the tray when the header is full", () => {
		const full = keys(7);
		const layout = resolveHeaderLayout(["new", ...full], { top: full, tray: [] });
		expect(layout.top).toEqual(full);
		expect(layout.tray).toEqual(["new"]);
	});

	it("ignores unavailable keys but does not choke on duplicates", () => {
		const layout = resolveHeaderLayout(["a", "b"], { top: ["gone", "a", "a"], tray: ["b", "a"] });
		expect(layout).toEqual({ top: ["a"], tray: ["b"] });
	});

	it("spills an over-long saved header into the front of the tray", () => {
		const layout = resolveHeaderLayout(keys(9), { top: keys(9), tray: [] });
		expect(layout.top).toEqual(keys(7));
		expect(layout.tray).toEqual(["k7", "k8"]);
	});
});

describe("resolveHeaderLayout defaults for a user who never customised", () => {
	const all = [
		"p:other",
		"open-in-app:open-in-app",
		"builtin:export",
		"builtin:pin",
		"builtin:terminal",
		"builtin:bottom-panel",
	];

	it("shows only the default actions, in the default order, and stows the rest", () => {
		const layout = resolveHeaderLayout(all, null, MAX_TOP_ACTIONS, DEFAULT_TOP_ACTIONS);
		expect(layout.top).toEqual(["builtin:terminal", "builtin:bottom-panel", "builtin:export"]);
		expect(layout.tray).toEqual(["p:other", "open-in-app:open-in-app", "builtin:pin"]);
	});

	it("skips a default action that is not available", () => {
		const layout = resolveHeaderLayout(
			all.filter((key) => key !== "builtin:terminal"),
			null,
			MAX_TOP_ACTIONS,
			DEFAULT_TOP_ACTIONS,
		);
		expect(layout.top).toEqual(["builtin:bottom-panel", "builtin:export"]);
	});

	it("ignores the defaults once the user has a saved layout", () => {
		const layout = resolveHeaderLayout(all, { top: ["builtin:pin"], tray: [] }, MAX_TOP_ACTIONS, DEFAULT_TOP_ACTIONS);
		// 以存下来的为准：pin 在顶栏，没存过的新动作按「还有空位就上栏」处理，而不是套默认的三个。
		expect(layout.top).toContain("builtin:pin");
		expect(layout.tray).toEqual([]);
	});
});

describe("moveHeaderAction", () => {
	const base = { top: ["a", "b", "c"], tray: ["x", "y"] };

	it("reorders inside the header, compensating for the dragged item's own slot", () => {
		expect(moveHeaderAction(base, "a", "top", 3)?.top).toEqual(["b", "c", "a"]);
		expect(moveHeaderAction(base, "c", "top", 0)?.top).toEqual(["c", "a", "b"]);
		expect(moveHeaderAction(base, "a", "top", 1)?.top).toEqual(["a", "b", "c"]);
	});

	it("moves across zones at the requested index and clamps out-of-range ones", () => {
		expect(moveHeaderAction(base, "x", "top", 1)).toEqual({ top: ["a", "x", "b", "c"], tray: ["y"] });
		expect(moveHeaderAction(base, "b", "tray", Number.MAX_SAFE_INTEGER)).toEqual({
			top: ["a", "c"],
			tray: ["x", "y", "b"],
		});
	});

	it("rejects moving into a full header but still allows reordering inside it", () => {
		const full = { top: keys(7), tray: ["x"] };
		expect(moveHeaderAction(full, "x", "top", 0)).toBeNull();
		expect(moveHeaderAction(full, "k0", "top", 7)?.top).toEqual([...keys(7).slice(1), "k0"]);
	});

	it("returns null for an unknown key", () => {
		expect(moveHeaderAction(base, "nope", "top", 0)).toBeNull();
	});

	it("keeps unavailable saved keys so a disabled plugin finds its place again", () => {
		const next = moveHeaderAction(base, "a", "tray", 0, { top: ["gone", "a"], tray: ["gone2"] });
		expect(next?.top).toEqual(["b", "c", "gone"]);
		expect(next?.tray).toEqual(["a", "x", "y", "gone2"]);
	});
});
