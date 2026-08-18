import { useThemeComponent } from "@vetta/theme-sdk";
import { InputBarView } from "./input-bar/InputBarView";
import { useInputBarModel } from "./input-bar/useInputBarModel";
import type { InputBarProps } from "./input-bar/types";

export function InputBar(props: InputBarProps): JSX.Element {
	const model = useInputBarModel(props);
	const ThemedInputBarView = useThemeComponent("chat.inputBarView", InputBarView);

	return <ThemedInputBarView model={model} />;
}

export type { InputBarProps };
