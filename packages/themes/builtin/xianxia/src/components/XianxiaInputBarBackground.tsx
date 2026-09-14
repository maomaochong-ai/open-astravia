import {
	InputBarBackground,
	type InputBarBackgroundProps,
} from "@vetta-org/theme-ui";
import type { JSX } from "react";

export function XianxiaInputBarBackground({
	className,
	...props
}: InputBarBackgroundProps): JSX.Element {
	return (
		<InputBarBackground
			className={["z-[0]", className].filter(Boolean).join(" ")}
			{...props}
		/>
	);
}
