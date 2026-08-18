import { useMatches, useNavigate } from "@tanstack/react-router";
import type { ThemeNavigationTarget, ThemeRouteArea, ThemeRouteModel } from "@vetta/theme-sdk/routing";

function resolveRouteArea(pathname: string): ThemeRouteArea {
	if (pathname === "/automation") return "automation";
	if (pathname === "/batch-tasks") return "batchTasks";
	if (pathname === "/knowledge" || pathname === "/knowledge/all") return "knowledgeBase";
	// 插件已并入能力页（ADR-0049）；theme-sdk 的 plugins area 不再对应任何路由。
	if (pathname === "/abilities" || pathname.startsWith("/abilities/")) return "skills";
	if (pathname.startsWith("/settings")) return "settings";
	if (pathname.startsWith("/project")) return "project";
	if (pathname.startsWith("/theme/")) return "themePage";
	if (pathname === "/" || pathname.startsWith("/new-session") || pathname.startsWith("/viewer")) return "chat";
	return "unknown";
}

export function useThemeRouteModel(): ThemeRouteModel {
	const matches = useMatches();
	const navigate = useNavigate();
	const pathname = matches[matches.length - 1]?.pathname ?? "/";
	const area = resolveRouteArea(pathname);

	const navigateToTarget = (target: ThemeNavigationTarget): void => {
		switch (target.kind) {
			case "automation":
				void navigate({ to: "/automation" });
				return;
			case "batchTasks":
				void navigate({ to: "/batch-tasks" });
				return;
			case "chat":
				void navigate({ to: "/" });
				return;
			case "knowledgeBase":
				void navigate({ to: "/knowledge" });
				return;
			case "knowledgeBaseList":
				void navigate({ to: "/knowledge/all" });
				return;
			case "plugins":
			case "skills":
				void navigate({ to: "/abilities" });
				return;
		}
	};

	return {
		current: {
			area,
			pathname,
		},
		isAreaActive: (targetArea) => area === targetArea,
		navigate: navigateToTarget,
	};
}
