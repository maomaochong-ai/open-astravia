import { useThemeComponent } from "@vetta-org/theme-sdk";
import { useWindowControlsModel } from "@vetta-org/theme-sdk/app-shell";
import { DefaultWindowControls } from "@vetta-org/theme-ui/app-shell/DefaultWindowControls";
import type { WindowControlsProps } from "./types";

export { DefaultWindowControls } from "@vetta-org/theme-ui/app-shell/DefaultWindowControls";

export function WindowControls(props: WindowControlsProps): JSX.Element {
	const model = useWindowControlsModel();
	const ThemeWindowControls = useThemeComponent("app.windowControls", DefaultWindowControls);
	return <ThemeWindowControls {...props} model={model} />;
}
