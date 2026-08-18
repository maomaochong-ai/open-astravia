import { useThemeComponent } from "@vetta/theme-sdk";
import { useWindowControlsModel } from "@vetta/theme-sdk/app-shell";
import { DefaultWindowControls } from "@vetta/theme-ui/app-shell";
import type { WindowControlsProps } from "./types";

export { DefaultWindowControls } from "@vetta/theme-ui/app-shell";

export function WindowControls(props: WindowControlsProps): JSX.Element {
	const model = useWindowControlsModel();
	const ThemeWindowControls = useThemeComponent("app.windowControls", DefaultWindowControls);
	return <ThemeWindowControls {...props} model={model} />;
}
