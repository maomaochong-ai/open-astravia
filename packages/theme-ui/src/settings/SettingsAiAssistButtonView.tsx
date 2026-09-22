import { forwardRef, type JSX } from "react";
import { cn } from "@vetta-org/ui";

export interface SettingsAiAssistButtonViewProps {
	readonly label: string;
	readonly className?: string;
	readonly onClick?: () => void;
}

/**
 * Compact AI-assist CTA: magic-wand icon + short label.
 * 静态图标：这枚按钮常驻在设置页与自动化页的顶栏，循环的魔杖晃动与闪烁星点
 * 会让整窗每帧重绘，在毛玻璃窗口上 GPU 代价被放大。悬停只做 CSS 颜色过渡。
 * Ref-forwarding so it can act as PopoverTrigger (asChild).
 */
export const SettingsAiAssistButtonView = forwardRef<HTMLButtonElement, SettingsAiAssistButtonViewProps>(
	function SettingsAiAssistButtonView({ label, className, onClick }, ref): JSX.Element {
		return (
			<button
				ref={ref}
				type="button"
				onClick={onClick}
				title={label}
				aria-label={label}
				data-settings-ai-assist-trigger=""
				className={cn(
					"inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-transparent px-1.5",
					"bg-transparent text-[12px] font-medium text-primary outline-none select-none",
					"transition-colors duration-150 hover:bg-primary/10",
					"focus-visible:border-ring",
					"disabled:pointer-events-none disabled:opacity-50",
					className,
				)}
			>
				<span aria-hidden className="icon-[solar--magic-stick-3-bold] h-3.5 w-3.5 shrink-0" />
				<span className="whitespace-nowrap">{label}</span>
			</button>
		);
	},
);
