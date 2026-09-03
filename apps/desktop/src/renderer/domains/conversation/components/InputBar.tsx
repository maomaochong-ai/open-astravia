import { InputBarPresentation } from "./input-bar/InputBarPresentation";
import type { InputBarProps } from "./input-bar/types";

export function InputBar({ model }: InputBarProps): JSX.Element {
	return <InputBarPresentation model={model} />;
}

export type { InputBarProps };
