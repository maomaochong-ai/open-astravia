import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import type { JSX } from "react";
import { useThemeRuntime } from "../runtime";
import { ThemePageRouteShell } from "./ThemePageRouteShell";
import { useActiveThemePageRoute } from "./useActiveThemePageRoute";

export function ThemePageRoute({ themeId, pageId }: { themeId?: string; pageId?: string } = {}): JSX.Element {
	const navigate = useNavigate();
	const { activeThemeId, availableThemes, selectTheme, status } = useThemeRuntime();
	const override = themeId !== undefined && pageId !== undefined ? { themeId, pageId } : undefined;
	const themePageRoute = useActiveThemePageRoute(override);

	useEffect(() => {
		if (!themePageRoute?.isThemePageRoute) return;
		if (themePageRoute.page) return;

		if (status === "loading") return;

		if (themePageRoute.themeId !== activeThemeId && availableThemes.some((t) => t.id === themePageRoute.themeId)) {
			void selectTheme(themePageRoute.themeId);
			return;
		}

		void navigate({ to: "/", replace: true });
	}, [navigate, themePageRoute, status, activeThemeId, availableThemes, selectTheme]);

	if (status !== "ready" || !themePageRoute?.page) {
		return <ThemePageRouteShell themeId={themeId} pageId={pageId} />;
	}

	const Page = themePageRoute.page.component;
	return (
		<Page
			layout={themePageRoute.layout}
			pageId={themePageRoute.pageId}
			themeId={themePageRoute.themeId}
		/>
	);
}
