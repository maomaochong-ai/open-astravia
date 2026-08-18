import { describe, expect, it } from "vitest";
import { toSidebarNavBadge } from "./sidebar-nav-badge";

/** 插件目录解析：`%key%` 命中就换成目录文案，否则原样返回（与 label 同一行为）。 */
const catalog: Record<string, string> = { "%badge.unread%": "未读" };
const resolve = (raw: string): string => catalog[raw] ?? raw;

describe("toSidebarNavBadge", () => {
	it("beta 用宿主自己的文案，插件不必翻译一遍", () => {
		expect(toSidebarNavBadge({ kind: "beta" }, resolve, "Beta")).toEqual({ kind: "text", text: "Beta" });
	});

	it("text 走插件目录解析 %key%，并保留 tone", () => {
		expect(toSidebarNavBadge({ kind: "text", text: "%badge.unread%", tone: "warning" }, resolve, "Beta")).toEqual({
			kind: "text",
			text: "未读",
			tone: "warning",
		});
		expect(toSidebarNavBadge({ kind: "text", text: "New" }, resolve, "Beta")).toEqual({ kind: "text", text: "New" });
	});

	it("解析后为空就不出角标：空胶囊比没有更糟", () => {
		expect(toSidebarNavBadge({ kind: "text", text: "   " }, resolve, "Beta")).toBeUndefined();
		expect(toSidebarNavBadge({ kind: "beta" }, resolve, "  ")).toBeUndefined();
	});

	it("count / dot 不需要文案，原样透传", () => {
		expect(toSidebarNavBadge({ kind: "count", count: 12 }, resolve, "Beta")).toEqual({ kind: "count", count: 12 });
		expect(toSidebarNavBadge({ kind: "dot", tone: "danger" }, resolve, "Beta")).toEqual({
			kind: "dot",
			tone: "danger",
		});
	});

	it("没有角标就是没有", () => {
		expect(toSidebarNavBadge(undefined, resolve, "Beta")).toBeUndefined();
	});
});
