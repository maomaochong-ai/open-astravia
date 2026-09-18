import { describe, expect, it } from "vitest";
import { type PersistentSurfaceId, persistentSurfaceIdForPath, rememberVisitedSurface } from "./persistent-surface";

describe("persistentSurfaceIdForPath", () => {
	it("把侧栏高频入口映射到保活 surface", () => {
		expect(persistentSurfaceIdForPath("/")).toBe("chat");
		expect(persistentSurfaceIdForPath("/settings/models")).toBe("settings");
		expect(persistentSurfaceIdForPath("/abilities")).toBe("abilities");
		expect(persistentSurfaceIdForPath("/agents")).toBe("agents");
		expect(persistentSurfaceIdForPath("/new-session")).toBe("new-session");
		expect(persistentSurfaceIdForPath("/knowledge")).toBe("knowledge");
		expect(persistentSurfaceIdForPath("/knowledge/all")).toBe("knowledge-all");
		expect(persistentSurfaceIdForPath("/scenes")).toBe("scenes");
		expect(persistentSurfaceIdForPath("/automation")).toBe("automation");
		expect(persistentSurfaceIdForPath("/batch-tasks")).toBe("batch-tasks");
	});

	it("团队会话走独立 LRU，不映射到内置 surface", () => {
		expect(persistentSurfaceIdForPath("/agent-teams/t1/sessions/s1")).toBeNull();
		expect(persistentSurfaceIdForPath("/workspace/plugin/view")).toBeNull();
		expect(persistentSurfaceIdForPath("/theme/xianxia/sanctum")).toBeNull();
		expect(persistentSurfaceIdForPath("/project/foo")).toBeNull();
		expect(persistentSurfaceIdForPath("/viewer/x")).toBeNull();
	});
});

describe("rememberVisitedSurface", () => {
	it("第一次走进才写入，重复走进保持同一 Set", () => {
		const empty = new Set<PersistentSurfaceId>();
		const withSettings = rememberVisitedSurface(empty, "settings");
		expect([...withSettings]).toEqual(["settings"]);
		expect(rememberVisitedSurface(withSettings, "settings")).toBe(withSettings);
		expect(rememberVisitedSurface(withSettings, null)).toBe(withSettings);
		expect([...rememberVisitedSurface(withSettings, "abilities")]).toEqual(["settings", "abilities"]);
	});
});
