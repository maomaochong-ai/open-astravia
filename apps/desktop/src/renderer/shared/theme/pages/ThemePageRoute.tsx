import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useThemeRuntime } from "../runtime";
import { useActiveThemePageRoute } from "./useActiveThemePageRoute";

export function ThemePageRoute(): JSX.Element | null {
	const navigate = useNavigate();
	const { activeThemeId, availableThemes, selectTheme, status } = useThemeRuntime();
	const themePageRoute = useActiveThemePageRoute();

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

	if (status !== "ready" || !themePageRoute?.page) return null;

	const Page = themePageRoute.page.component;
	return (
		<Page
			layout={themePageRoute.layout}
			pageId={themePageRoute.pageId}
			themeId={themePageRoute.themeId}
		/>
	);
}
