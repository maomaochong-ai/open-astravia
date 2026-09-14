import { useSystemInfo } from "@vetta-org/theme-sdk";
import { AppBackground, type AppBackgroundProps } from "@vetta-org/theme-ui";
import { cn } from "@vetta-org/ui";
import type { JSX } from "react";

export function XianxiaAppBackground({
	className,
	...props
}: AppBackgroundProps): JSX.Element {
	const systemInfo = useSystemInfo();

	return (
		<AppBackground
			className={cn(className, systemInfo.isMac && "xianxia-app-background-edge-to-edge")}
			{...props}
		/>
	);
}
