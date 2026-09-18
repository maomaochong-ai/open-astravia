import { describe, expect, it } from "vitest";
import { isChatSurfacePath } from "./isChatSurfacePath";

describe("isChatSurfacePath", () => {
	it("把主对话和未匹配路由视为聊天页", () => {
		expect(isChatSurfacePath("/")).toBe(true);
		expect(isChatSurfacePath("")).toBe(true);
		expect(isChatSurfacePath("/unknown-deep-link")).toBe(true);
	});

	it("把侧栏产品页和设置页视为非聊天页", () => {
		expect(isChatSurfacePath("/abilities")).toBe(false);
		expect(isChatSurfacePath("/abilities/skill/foo")).toBe(false);
		expect(isChatSurfacePath("/settings/appearance")).toBe(false);
		expect(isChatSurfacePath("/new-session")).toBe(false);
		expect(isChatSurfacePath("/agents")).toBe(false);
		expect(isChatSurfacePath("/agent-teams/t1/sessions/s1")).toBe(false);
		expect(isChatSurfacePath("/workspace/plugin/view")).toBe(false);
		expect(isChatSurfacePath("/theme/xianxia/sanctum")).toBe(false);
	});
});
