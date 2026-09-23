import { useThemeComponent } from "@vetta-org/theme-sdk";
import { InputBarView } from "./InputBarView";
import type { InputBarProps } from "./types";

export function InputBarPresentation({ model, children }: InputBarProps): JSX.Element {
	const ThemedInputBarView = useThemeComponent("chat.inputBarView", InputBarView);
	return <ThemedInputBarView model={model}>{children}</ThemedInputBarView>;
}
