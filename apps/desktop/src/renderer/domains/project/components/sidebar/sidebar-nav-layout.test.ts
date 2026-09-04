import { describe, expect, it } from "vitest";
import {
	canPinMore,
	EMPTY_SIDEBAR_NAV_LAYOUT,
	EXTENSIONS_NAV_KEY,
	MAX_PINNED_NAV_ITEMS,
	moveNavKeyToRegion,
	NEW_SESSION_NAV_KEY,
	parseSidebarNavLayout,
	pinNavKey,
	reorderNavKeys,
	resolveSidebarNavLayout,
	toStoredSidebarNavLayout,
	unpinNavKey,
} from "./sidebar-nav-layout";

const CATALOG = [NEW_SESSION_NAV_KEY, "/automation", "/knowledge", "/abilities", "/batch-tasks", "/settings/models"];
const DEFAULT_PINNED = ["/automation", "/knowledge", "/abilities"];

describe("resolveSidebarNavLayout", () => {
	it("首次使用时按默认置顶集合分区，新会话恒在首位", () => {
		const resolved = resolveSidebarNavLayout(CATALOG, EMPTY_SIDEBAR_NAV_LAYOUT, DEFAULT_PINNED);
		expect(resolved.pinned).toEqual([NEW_SESSION_NAV_KEY, "/automation", "/knowledge", "/abilities"]);
		expect(resolved.more).toEqual(["/batch-tasks", "/settings/models"]);
	});

	it("丢弃目录中已不存在的 key（插件卸载）", () => {
		const resolved = resolveSidebarNavLayout(
			CATALOG,
			{ pinned: ["/automation", "workspace:gone/board"], more: ["/batch-tasks"] },
			DEFAULT_PINNED,
		);
		expect(resolved.pinned).not.toContain("workspace:gone/board");
		expect(resolved.more).not.toContain("workspace:gone/board");
		// 其余记过的 key 保持原区，未记过的默认置顶项照常补位。
		expect(resolved.pinned).toContain("/automation");
		expect(resolved.more).toContain("/batch-tasks");
	});

	it("目录中新出现且不在默认置顶集合的 key 追加到收纳区末尾", () => {
		const resolved = resolveSidebarNavLayout(
			[...CATALOG, "workspace:kanban/board"],
			{ pinned: ["/automation"], more: ["/batch-tasks"] },
			DEFAULT_PINNED,
		);
		expect(resolved.more.at(-1)).toBe("workspace:kanban/board");
	});

	it("用户收纳过的默认置顶项不会被默认值拉回置顶区", () => {
		const resolved = resolveSidebarNavLayout(
			CATALOG,
			{ pinned: [], more: ["/automation", "/knowledge", "/abilities", "/batch-tasks", "/settings/models"] },
			DEFAULT_PINNED,
		);
		expect(resolved.pinned).toEqual([NEW_SESSION_NAV_KEY]);
	});

	it("置顶区溢出项退回收纳区最前而非丢失", () => {
		const resolved = resolveSidebarNavLayout(
			CATALOG,
			{ pinned: ["/automation", "/knowledge", "/abilities", "/batch-tasks", "/settings/models"], more: [] },
			DEFAULT_PINNED,
		);
		expect(resolved.pinned).toHaveLength(MAX_PINNED_NAV_ITEMS);
		expect(resolved.pinned[0]).toBe(NEW_SESSION_NAV_KEY);
		expect(resolved.more).toEqual(["/settings/models"]);
	});

	it("持久化里混入的 new-session 被忽略，不会占用用户可排布的位置", () => {
		const resolved = resolveSidebarNavLayout(
			CATALOG,
			{ pinned: [NEW_SESSION_NAV_KEY, "/automation"], more: [NEW_SESSION_NAV_KEY] },
			[],
		);
		expect(resolved.pinned).toEqual([NEW_SESSION_NAV_KEY, "/automation"]);
		expect(resolved.more.filter((key) => key === NEW_SESSION_NAV_KEY)).toHaveLength(0);
	});

	it("重复 key 只保留第一次出现", () => {
		const resolved = resolveSidebarNavLayout(CATALOG, { pinned: ["/automation", "/automation"], more: [] }, []);
		expect(resolved.pinned).toEqual([NEW_SESSION_NAV_KEY, "/automation"]);
	});
});

describe("pin / unpin", () => {
	const base = resolveSidebarNavLayout(CATALOG, EMPTY_SIDEBAR_NAV_LAYOUT, DEFAULT_PINNED);

	it("pin 把收纳项移到置顶区末尾", () => {
		const next = pinNavKey(base, "/batch-tasks");
		expect(next.pinned).toEqual([NEW_SESSION_NAV_KEY, "/automation", "/knowledge", "/abilities", "/batch-tasks"]);
		expect(next.more).toEqual(["/settings/models"]);
	});

	it("置顶区已满时 pin 无效（不挤掉已有项）", () => {
		const full = pinNavKey(base, "/batch-tasks");
		expect(canPinMore(full)).toBe(false);
		expect(pinNavKey(full, "/settings/models")).toBe(full);
	});

	it("unpin 把置顶项收回收纳区最前", () => {
		const next = unpinNavKey(base, "/knowledge");
		expect(next.pinned).toEqual([NEW_SESSION_NAV_KEY, "/automation", "/abilities"]);
		expect(next.more[0]).toBe("/knowledge");
	});

	it("新会话既不能 pin 也不能 unpin", () => {
		expect(unpinNavKey(base, NEW_SESSION_NAV_KEY)).toBe(base);
		expect(pinNavKey(base, NEW_SESSION_NAV_KEY)).toBe(base);
	});
});

describe("reorderNavKeys", () => {
	const base = resolveSidebarNavLayout(CATALOG, EMPTY_SIDEBAR_NAV_LAYOUT, DEFAULT_PINNED);

	it("同区内重排", () => {
		const next = reorderNavKeys(base, "pinned", "/abilities", "/automation");
		expect(next.pinned).toEqual([NEW_SESSION_NAV_KEY, "/abilities", "/automation", "/knowledge"]);
	});

	it("拖到新会话位置时落到其后，新会话仍锁首位", () => {
		const next = reorderNavKeys(base, "pinned", "/knowledge", NEW_SESSION_NAV_KEY);
		expect(next.pinned[0]).toBe(NEW_SESSION_NAV_KEY);
		expect(next.pinned[1]).toBe("/knowledge");
	});

	it("拖动新会话本身无效", () => {
		expect(reorderNavKeys(base, "pinned", NEW_SESSION_NAV_KEY, "/knowledge")).toBe(base);
	});

	it("toKey 为 null 表示移到末尾", () => {
		const next = reorderNavKeys(base, "more", "/batch-tasks", null);
		expect(next.more).toEqual(["/settings/models", "/batch-tasks"]);
	});

	it("未知 key 原样返回", () => {
		expect(reorderNavKeys(base, "more", "/nope", "/batch-tasks")).toBe(base);
	});
});

describe("moveNavKeyToRegion", () => {
	const base = resolveSidebarNavLayout(
		CATALOG,
		{ pinned: ["/automation"], more: ["/knowledge", "/abilities", "/batch-tasks", "/settings/models"] },
		[],
	);

	it("跨区移入置顶区的指定位置", () => {
		const next = moveNavKeyToRegion(base, "/abilities", "pinned", "/automation");
		expect(next.pinned).toEqual([NEW_SESSION_NAV_KEY, "/abilities", "/automation"]);
		expect(next.more).not.toContain("/abilities");
	});

	it("插到新会话之前时被夹到其后", () => {
		const next = moveNavKeyToRegion(base, "/abilities", "pinned", NEW_SESSION_NAV_KEY);
		expect(next.pinned[0]).toBe(NEW_SESSION_NAV_KEY);
		expect(next.pinned).toContain("/abilities");
	});

	it("跨区移回收纳区", () => {
		const next = moveNavKeyToRegion(base, "/automation", "more", "/knowledge");
		expect(next.pinned).toEqual([NEW_SESSION_NAV_KEY]);
		expect(next.more[0]).toBe("/automation");
	});

	it("置顶区已满时拒绝移入", () => {
		const full = resolveSidebarNavLayout(
			CATALOG,
			{ pinned: ["/automation", "/knowledge", "/abilities", "/batch-tasks"], more: ["/settings/models"] },
			[],
		);
		expect(moveNavKeyToRegion(full, "/settings/models", "pinned", null)).toBe(full);
	});

	it("同区移动等价于重排", () => {
		const next = moveNavKeyToRegion(base, "/batch-tasks", "more", "/knowledge");
		expect(next.more).toEqual(["/batch-tasks", "/knowledge", "/abilities", "/settings/models"]);
	});
});

describe("持久化", () => {
	it("落盘去掉恒定的新会话", () => {
		const resolved = resolveSidebarNavLayout(CATALOG, EMPTY_SIDEBAR_NAV_LAYOUT, DEFAULT_PINNED);
		expect(toStoredSidebarNavLayout(resolved).pinned).not.toContain(NEW_SESSION_NAV_KEY);
	});

	it("解析脏数据不抛错", () => {
		expect(parseSidebarNavLayout(null)).toEqual(EMPTY_SIDEBAR_NAV_LAYOUT);
		expect(parseSidebarNavLayout("x")).toEqual(EMPTY_SIDEBAR_NAV_LAYOUT);
		expect(parseSidebarNavLayout({ pinned: "a", more: 1 })).toEqual(EMPTY_SIDEBAR_NAV_LAYOUT);
	});

	it("同一 key 同时出现在两区时以置顶区为准", () => {
		expect(parseSidebarNavLayout({ pinned: ["/a"], more: ["/a", "/b"] })).toEqual({ pinned: ["/a"], more: ["/b"] });
	});

	it("落盘再解析后布局稳定", () => {
		const resolved = pinNavKey(resolveSidebarNavLayout(CATALOG, EMPTY_SIDEBAR_NAV_LAYOUT, []), "/knowledge");
		const round = resolveSidebarNavLayout(CATALOG, parseSidebarNavLayout(toStoredSidebarNavLayout(resolved)), []);
		expect(round).toEqual(resolved);
	});
});

describe("「更多选项」锁定末位", () => {
	const CATALOG_WITH_EXTENSIONS = [...CATALOG, EXTENSIONS_NAV_KEY];
	const base = resolveSidebarNavLayout(CATALOG_WITH_EXTENSIONS, EMPTY_SIDEBAR_NAV_LAYOUT, DEFAULT_PINNED);

	it("恒排在收纳区末位", () => {
		expect(base.more).toEqual(["/batch-tasks", "/settings/models", EXTENSIONS_NAV_KEY]);
	});

	it("旧布局把它排在别处也会被拉回末位", () => {
		const resolved = resolveSidebarNavLayout(
			CATALOG_WITH_EXTENSIONS,
			{ pinned: [EXTENSIONS_NAV_KEY], more: [EXTENSIONS_NAV_KEY, "/batch-tasks"] },
			[],
		);
		expect(resolved.pinned).not.toContain(EXTENSIONS_NAV_KEY);
		expect(resolved.more[resolved.more.length - 1]).toBe(EXTENSIONS_NAV_KEY);
	});

	it("不可置顶、不可重排", () => {
		expect(pinNavKey(base, EXTENSIONS_NAV_KEY)).toBe(base);
		expect(unpinNavKey(base, EXTENSIONS_NAV_KEY)).toBe(base);
		expect(reorderNavKeys(base, "more", EXTENSIONS_NAV_KEY, "/batch-tasks")).toBe(base);
		expect(moveNavKeyToRegion(base, EXTENSIONS_NAV_KEY, "pinned", null)).toBe(base);
	});

	it("别的项落到收纳区末尾时停在它之前", () => {
		expect(reorderNavKeys(base, "more", "/batch-tasks", null).more).toEqual([
			"/settings/models",
			"/batch-tasks",
			EXTENSIONS_NAV_KEY,
		]);
		expect(moveNavKeyToRegion(base, "/automation", "more", null).more).toEqual([
			"/batch-tasks",
			"/settings/models",
			"/automation",
			EXTENSIONS_NAV_KEY,
		]);
	});

	it("不进落盘布局（它由目录决定有无）", () => {
		expect(toStoredSidebarNavLayout(base).more).not.toContain(EXTENSIONS_NAV_KEY);
		expect(parseSidebarNavLayout({ pinned: [], more: [EXTENSIONS_NAV_KEY, "/a"] })).toEqual({
			pinned: [],
			more: ["/a"],
		});
	});
});
