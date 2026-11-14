import { cn } from "@astravia-org/ui/utils";
import type { JSX } from "react";

/**
 * Splash 里的选项行：图标 + 标题 + 一行描述。
 * 与 CommandMenuRow 同一套悬停底色，区别是描述另起一行——选项面板没有搜索，
 * 描述是用户做选择的依据，不能像命令面板的副标题那样被截成半截。
 */

export interface SplashOptionRowProps {
	/** iconify 类名。 */
	readonly icon: string;
	readonly title: string;
	readonly description?: string;
	readonly disabled?: boolean;
	readonly onSelect: () => void;
}

export function SplashOptionRow({
	icon,
	title,
	description,
	disabled,
	onSelect,
}: SplashOptionRowProps): JSX.Element {
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onSelect}
			className={cn(
				"flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors",
				"hover:bg-primary/10 focus-visible:bg-primary/10",
				disabled && "cursor-not-allowed opacity-45",
			)}
		>
			<span aria-hidden="true" className={cn(icon, "mt-0.5 size-4 shrink-0 text-muted-foreground")} />
			<span className="min-w-0 flex-1">
				<span className="block text-[13px] text-foreground">{title}</span>
				{description && (
					<span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{description}</span>
				)}
			</span>
		</button>
	);
}
