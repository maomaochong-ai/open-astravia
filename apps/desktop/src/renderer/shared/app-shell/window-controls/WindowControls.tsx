import { useThemeComponent } from "@astravia-org/theme-sdk";
import { useWindowControlsModel } from "@astravia-org/theme-sdk/app-shell";
import { DefaultWindowControls } from "@astravia-org/theme-ui/app-shell";
import type { WindowControlsProps } from "./types";

export { DefaultWindowControls } from "@astravia-org/theme-ui/app-shell";

export function WindowControls(props: WindowControlsProps): JSX.Element {
	const model = useWindowControlsModel();
	const ThemeWindowControls = useThemeComponent("app.windowControls", DefaultWindowControls);
	return <ThemeWindowControls {...props} model={model} />;
}
