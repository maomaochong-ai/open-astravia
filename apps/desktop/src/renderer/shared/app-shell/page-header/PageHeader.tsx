import { useThemeRegion } from "@astravia-org/theme-sdk";
import { usePageHeaderModel } from "@astravia-org/theme-sdk/app-shell";
import { DefaultPageHeader } from "@astravia-org/theme-ui/app-shell";
import { WindowControls } from "@shared/app-shell/window-controls";
import type { PageHeaderProps } from "./types";

export { DefaultPageHeader } from "@astravia-org/theme-ui/app-shell";

export function PageHeader(props: PageHeaderProps): JSX.Element {
	const model = usePageHeaderModel(props);
	const ThemePageHeader = useThemeRegion("app.pageHeader");
	if (ThemePageHeader) {
		return <ThemePageHeader {...props} model={model} />;
	}
	return <DefaultPageHeader {...props} model={model} windowControls={<WindowControls />} />;
}
