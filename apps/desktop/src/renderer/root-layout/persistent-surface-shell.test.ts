import { describe, expect, it } from "vitest";
import { persistentSurfaceTitleRef } from "./persistent-surface-shell";

describe("persistentSurfaceTitleRef", () => {
	it("有页内标题的侧栏页给出 i18n 引用，新会话壳用问候语", () => {
		expect(persistentSurfaceTitleRef("abilities")).toEqual({ ns: "abilities", key: "page.title" });
		expect(persistentSurfaceTitleRef("agents")).toEqual({ ns: "agent-teams", key: "center.title" });
		expect(persistentSurfaceTitleRef("knowledge")).toEqual({ ns: "settings", key: "kbPageTitle" });
		expect(persistentSurfaceTitleRef("knowledge-all")).toEqual({ ns: "settings", key: "kbAllTitle" });
		expect(persistentSurfaceTitleRef("scenes")).toEqual({ ns: "skills", key: "tabs.scene" });
		expect(persistentSurfaceTitleRef("automation")).toEqual({ ns: "automation", key: "page.title" });
		expect(persistentSurfaceTitleRef("batch-tasks")).toEqual({ ns: "batch-tasks", key: "page.title" });
		expect(persistentSurfaceTitleRef("settings")).toEqual({ ns: "settings", key: "title" });
		expect(persistentSurfaceTitleRef("new-session")).toEqual({ ns: "chat", key: "newSession.greetingDefault" });
	});
});
