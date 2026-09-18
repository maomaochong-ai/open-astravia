// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import type { ThemeModule } from "@vetta-org/theme-sdk";
import { describe, expect, it, vi } from "vitest";

const matches = vi.hoisted(() => ({
	current: [{ params: { themeId: "route-theme", pageId: "route-page" } }],
}));

const theme = vi.hoisted(
	() =>
		({
			meta: { id: "kept-theme", name: "Kept", sdkVersion: "0.1.0", version: "0.1.0" },
			pages: [
				{
					id: "kept-page",
					component: () => null,
					title: { "zh-CN": "保活页" },
				},
			],
		}) satisfies ThemeModule,
);

vi.mock("@tanstack/react-router", () => ({
	useMatches: () => matches.current,
}));
vi.mock("@vetta-org/theme-sdk", () => ({
	useThemeModule: () => theme,
}));

const { useActiveThemePageRoute } = await import("./useActiveThemePageRoute.js");

describe("useActiveThemePageRoute keep-alive identity", () => {
	it("保活宿主传入的 themeId/pageId 优先于当前 useMatches params", () => {
		const { result } = renderHook(() =>
			useActiveThemePageRoute({ themeId: "kept-theme", pageId: "kept-page" }),
		);

		expect(result.current).toMatchObject({
			themeId: "kept-theme",
			pageId: "kept-page",
			isThemePageRoute: true,
		});
		expect(result.current?.page?.id).toBe("kept-page");
	});

	it("未传入 override 时仍读当前路由 params", () => {
		const { result } = renderHook(() => useActiveThemePageRoute());

		expect(result.current).toMatchObject({
			themeId: "route-theme",
			pageId: "route-page",
			isThemePageRoute: true,
		});
		expect(result.current?.page).toBeUndefined();
	});
});
