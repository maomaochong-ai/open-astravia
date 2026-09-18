// @vitest-environment jsdom
import { render } from "@testing-library/react";
import type { ThemePageDefinition } from "@vetta-org/theme-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
	activeThemeId: "theme.example",
	availableThemes: [] as Array<{ id: string }>,
	selectTheme: vi.fn(),
	status: "loading" as "ready" | "loading" | "error",
}));

const route = vi.hoisted(() => ({
	current: undefined as
		| {
				isThemePageRoute: true;
				themeId: string;
				pageId: string;
				layout: "content";
				page: ThemePageDefinition | undefined;
		  }
		| undefined,
	override: undefined as { themeId: string; pageId: string } | undefined,
}));

const navigate = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigate,
}));

vi.mock("../runtime", () => ({
	useThemeRuntime: () => runtime,
}));

vi.mock("./useActiveThemePageRoute", () => ({
	useActiveThemePageRoute: (override?: { themeId: string; pageId: string }) => {
		route.override = override;
		return route.current;
	},
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
		i18n: { language: "zh-CN" },
	}),
}));

const { ThemePageRoute } = await import("./ThemePageRoute.js");
const { themePageShellTitle } = await import("./ThemePageRouteShell.js");

describe("ThemePageRoute", () => {
	beforeEach(() => {
		navigate.mockReset();
		runtime.selectTheme.mockReset();
		runtime.activeThemeId = "theme.example";
		runtime.availableThemes = [];
		runtime.status = "loading";
		route.current = undefined;
		route.override = undefined;
	});

	it("主题仍在 loading 时画出标题壳，不把主区留空", () => {
		runtime.status = "loading";
		route.current = {
			isThemePageRoute: true,
			themeId: "theme.example",
			pageId: "gallery",
			layout: "content",
			page: {
				id: "gallery",
				component: () => <p>theme-page-body</p>,
				title: { "zh-CN": "画廊", "en-US": "Gallery" },
			},
		};

		const { getByRole, queryByText } = render(<ThemePageRoute />);
		expect(getByRole("heading", { level: 1 }).textContent).toBe("画廊");
		expect(queryByText("theme-page-body")).toBeNull();
	});

	it("主题 loading 且页面尚未解析时显示回退标题，不踢回首页", () => {
		runtime.status = "loading";
		route.current = {
			isThemePageRoute: true,
			themeId: "theme.example",
			pageId: "gallery",
			layout: "content",
			page: undefined,
		};

		const { getByRole } = render(<ThemePageRoute />);
		expect(getByRole("heading", { level: 1 }).textContent).toBe("theme.title");
		expect(navigate).not.toHaveBeenCalled();
	});

	it("就绪且有页面时挂上主题页", () => {
		runtime.status = "ready";
		route.current = {
			isThemePageRoute: true,
			themeId: "theme.example",
			pageId: "gallery",
			layout: "content",
			page: {
				id: "gallery",
				component: () => <p>theme-page-body</p>,
				title: { "zh-CN": "画廊", "en-US": "Gallery" },
			},
		};

		const { getByText, queryByRole } = render(<ThemePageRoute />);
		expect(getByText("theme-page-body")).toBeTruthy();
		expect(queryByRole("heading", { level: 1 })).toBeNull();
	});

	it("保活宿主传入的 themeId/pageId 会作为 override 交给路由 hook", () => {
		runtime.status = "ready";
		route.current = {
			isThemePageRoute: true,
			themeId: "kept-theme",
			pageId: "kept-page",
			layout: "content",
			page: {
				id: "kept-page",
				component: () => <p>kept-theme-body</p>,
				title: { "zh-CN": "保活", "en-US": "Kept" },
			},
		};

		const { getByText } = render(<ThemePageRoute themeId="kept-theme" pageId="kept-page" />);
		expect(route.override).toEqual({ themeId: "kept-theme", pageId: "kept-page" });
		expect(getByText("kept-theme-body")).toBeTruthy();
	});

	it("就绪但没有对应页面时仍显示标题壳，并把用户送回首页", () => {
		runtime.status = "ready";
		runtime.availableThemes = [];
		route.current = {
			isThemePageRoute: true,
			themeId: "theme.example",
			pageId: "missing",
			layout: "content",
			page: undefined,
		};

		const { getByRole } = render(<ThemePageRoute />);
		expect(getByRole("heading", { level: 1 }).textContent).toBe("theme.title");
		expect(navigate).toHaveBeenCalledWith({ to: "/", replace: true });
	});
});

describe("themePageShellTitle", () => {
	it("优先用主题页标题，没有页面时回退到已有 i18n key", () => {
		expect(themePageShellTitle({ "zh-CN": "画廊" }, "zh-CN", "主题")).toBe("画廊");
		expect(themePageShellTitle(undefined, "zh-CN", "主题")).toBe("主题");
	});
});
