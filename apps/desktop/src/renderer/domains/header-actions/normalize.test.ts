import { describe, expect, it } from "vitest";
import { HEADER_ACTION_LIMITS, headerActionSignature, normalizeHeaderAction } from "./normalize";

const icon = "icon";

describe("normalizeHeaderAction", () => {
	it("null means not applicable, without a problem", () => {
		expect(normalizeHeaderAction(null)).toEqual({ value: null });
	});

	it("requires a title, an icon and exactly some behaviour", () => {
		expect(normalizeHeaderAction({ icon, onClick: () => {} }).problem).toMatch(/title/);
		expect(normalizeHeaderAction({ title: "t", onClick: () => {} }).problem).toMatch(/icon/);
		expect(normalizeHeaderAction({ title: "t", icon }).problem).toMatch(/onClick/);
	});

	it("prefers menuItems over popover over onClick", () => {
		const onSelect = () => {};
		const menu = normalizeHeaderAction({
			title: "t",
			icon,
			onClick: () => {},
			popover: () => null,
			menuItems: [{ id: "a", label: "A", onSelect }],
		});
		expect(menu.value?.behavior.type).toBe("menu");
		const popover = normalizeHeaderAction({ title: "t", icon, onClick: () => {}, popover: () => null });
		expect(popover.value?.behavior.type).toBe("popover");
		expect(normalizeHeaderAction({ title: "t", icon, onClick: () => {} }).value?.behavior.type).toBe("click");
	});

	it("clips the title and caps the menu", () => {
		const long = "x".repeat(100);
		const items = Array.from({ length: 30 }, (_, index) => ({ id: `i${index}`, label: long, onSelect: () => {} }));
		const { value } = normalizeHeaderAction({ title: long, icon, menuItems: items });
		expect(value?.title).toHaveLength(HEADER_ACTION_LIMITS.title);
		expect(value?.behavior.type === "menu" && value.behavior.items).toHaveLength(HEADER_ACTION_LIMITS.menuItems);
	});

	it("drops malformed and duplicate menu items; an empty menu falls through to the next behaviour", () => {
		const onSelect = () => {};
		const { value } = normalizeHeaderAction({
			title: "t",
			icon,
			onClick: () => {},
			menuItems: [{ id: "a", label: "", onSelect }, { id: "b", label: "B" }, null],
		});
		expect(value?.behavior.type).toBe("click");
	});

	it("accepts only positive numbers or true as a badge", () => {
		const base = { title: "t", icon, onClick: () => {} };
		expect(normalizeHeaderAction({ ...base, badge: 3 }).value?.badge).toBe(3);
		expect(normalizeHeaderAction({ ...base, badge: true }).value?.badge).toBe(true);
		expect(normalizeHeaderAction({ ...base, badge: 0 }).value?.badge).toBeUndefined();
		expect(normalizeHeaderAction({ ...base, badge: "9" }).value?.badge).toBeUndefined();
		expect(normalizeHeaderAction({ ...base, badge: Number.NaN }).value?.badge).toBeUndefined();
	});
});

describe("headerActionSignature", () => {
	const ids = (component: object) => (component as { id?: number }).id ?? 0;
	const base = () => ({ title: "t", icon: { type: "span", props: { className: "a" } }, onClick: () => {} });
	const sig = (raw: object) => {
		const { value } = normalizeHeaderAction(raw);
		if (!value) throw new Error("invalid");
		return headerActionSignature(value, ids);
	};

	it("is stable across re-renders that only produce new callbacks and element objects", () => {
		expect(sig(base())).toBe(sig(base()));
	});

	it("changes when something visible changes", () => {
		const original = sig(base());
		expect(sig({ ...base(), title: "u" })).not.toBe(original);
		expect(sig({ ...base(), badge: 2 })).not.toBe(original);
		expect(sig({ ...base(), active: true })).not.toBe(original);
		expect(sig({ ...base(), disabled: true })).not.toBe(original);
		expect(sig({ ...base(), icon: { type: "span", props: { className: "b" } } })).not.toBe(original);
	});

	it("tracks menu labels and disabled flags but not the select callbacks", () => {
		const menu = (disabled: boolean) => ({
			...base(),
			onClick: undefined,
			menuItems: [{ id: "a", label: "A", disabled, onSelect: () => {} }],
		});
		expect(sig(menu(false))).toBe(sig(menu(false)));
		expect(sig(menu(false))).not.toBe(sig(menu(true)));
	});
});
