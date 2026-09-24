import { InputBarPresentation } from "./input-bar/InputBarPresentation";
import type { InputBarProps } from "./input-bar/types";

export function InputBar({ model, children }: InputBarProps): JSX.Element {
	return <InputBarPresentation model={model}>{children}</InputBarPresentation>;
}

export type { InputBarProps };
