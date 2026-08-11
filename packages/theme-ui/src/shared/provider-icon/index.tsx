import type { JSX } from "react";
import { cn } from "@vetta/ui";
import { getProviderIcon } from "./icons.generated";

export { PROVIDER_ICONS, getProviderIcon } from "./icons.generated";

/**
 * 供应商图标。按 symbol 解析到内置图标渲染;symbol 为空或未注册时不渲染任何东西
 * (icon 字段可选,见 CONTEXT.md「icon symbol」)。
 */
export function ProviderIcon({
	symbol,
	className,
}: {
	symbol: string | undefined | null;
	className?: string;
}): JSX.Element | null {
	const src = getProviderIcon(symbol);
	if (!src) return null;
	return <img src={src} alt="" aria-hidden className={cn("shrink-0 rounded-[4px] object-contain", className)} />;
}
