import { useThemeComponent } from "@vetta-org/theme-sdk";
import { InputBarView } from "./InputBarView";
import type { InputBarModel } from "./types";

export function InputBarPresentation({ model }: { readonly model: InputBarModel }): JSX.Element {
	const ThemedInputBarView = useThemeComponent("chat.inputBarView", InputBarView);
	return <ThemedInputBarView model={model} />;
}
