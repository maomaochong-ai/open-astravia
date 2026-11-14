import type { PluginExternalApplication } from "@astravia-org/plugin-sdk";
import { describe, expect, it } from "vitest";
import { KIND_ICON, MAX_MENU_ITEMS, isOpenableCwd, labelKeyFor, sortForMenu } from "../src/apps";

const app = (id: string, kind: PluginExternalApplication["kind"]): PluginExternalApplication => ({
	id,
	name: id,
	kind,
	isDefault: false,
});

describe("open-in-app applicability", () => {
	it("only local, non-empty directories are openable", () => {
		expect(isOpenableCwd("/Users/me/project")).toBe(true);
		expect(isOpenableCwd("C:\\Users\\me\\project")).toBe(true);
		expect(isOpenableCwd("ssh://host/home/me/project")).toBe(false);
		expect(isOpenableCwd("")).toBe(false);
		expect(isOpenableCwd(null)).toBe(false);
		expect(isOpenableCwd(undefined)).toBe(false);
	});
});

describe("menu construction", () => {
	it("keeps the host order and never exceeds the host menu cap", () => {
		const many = Array.from({ length: MAX_MENU_ITEMS + 5 }, (_, index) => app(`a${index}`, "editor"));
		expect(sortForMenu(many)).toHaveLength(MAX_MENU_ITEMS);
		const ordered = [app("code", "editor"), app("finder", "file-manager"), app("wt", "terminal")];
		expect(sortForMenu(ordered).map((entry) => entry.id)).toEqual(["code", "finder", "wt"]);
	});

	it("uses a generic label for the file manager and the app's own name elsewhere", () => {
		expect(labelKeyFor(app("finder", "file-manager"))).toBe("app.reveal");
		expect(labelKeyFor(app("code", "editor"))).toBeNull();
		expect(labelKeyFor(app("wt", "terminal"))).toBeNull();
	});

	it("has a fallback icon for every kind the host can report", () => {
		expect(Object.keys(KIND_ICON).sort()).toEqual(["editor", "file-manager", "other", "terminal"]);
		for (const value of Object.values(KIND_ICON)) expect(value.startsWith("icon-[")).toBe(true);
	});
});
