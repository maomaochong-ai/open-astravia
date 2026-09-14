import { useThemeRouteModel } from "@vetta-org/theme-sdk";
import type { JSX } from "react";

const READABLE_BACKGROUND_AREAS = new Set(["automation", "batchTasks", "knowledgeBase", "skills"]);

export function XianxiaMainContentBackground(): JSX.Element | null {
	const route = useThemeRouteModel();

	if (!READABLE_BACKGROUND_AREAS.has(route.current.area)) {
		return null;
	}

	return (
		<div
			aria-hidden="true"
			className="xianxia-main-content-background pointer-events-none absolute inset-0 z-0 bg-primary-foreground/55 backdrop-blur-[1px]"
		/>
	);
}
