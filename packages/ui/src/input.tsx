import type { ComponentProps } from "react";
import { cn } from "./utils";

/**
 * 输入框的「填充」皮肤：无边框（透明占位）+ secondary 底色，悬停变 accent。
 * 能力广场搜索框与设置页各类输入框都从这里取，改样式只改这一处；叠在 <Input> 上使用。
 */
export const INPUT_FILL_CLASS =
	"border-transparent bg-secondary text-[12px] placeholder:text-muted-foreground/40 hover:border-transparent hover:bg-accent dark:bg-secondary md:text-[12px]";

/** 多行输入的同款皮肤（<textarea> 没有 <Input> 的基础样式，焦点环一并带上）。 */
export const TEXTAREA_FILL_CLASS =
	"rounded-lg border border-transparent bg-secondary px-2.5 py-2 text-[12px] text-foreground placeholder:text-muted-foreground/40 outline-none transition-[border-color,background-color,box-shadow] hover:bg-accent focus-visible:border-primary/60 focus-visible:ring-[3px] focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50";

function Input({ className, type, ...props }: ComponentProps<"input">) {
	return (
		<input
			type={type}
			data-slot="input"
			className={cn(
				"h-8 w-full min-w-0 rounded-lg border border-border/60 bg-transparent px-2.5 py-1 text-base shadow-none transition-[border-color,background-color,box-shadow] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground hover:border-border focus-visible:border-primary/60 focus-visible:ring-[3px] focus-visible:ring-primary/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/30 disabled:opacity-50 aria-invalid:border-destructive/70 md:text-sm dark:bg-input/20 dark:disabled:bg-input/50 dark:aria-invalid:border-destructive/60",
				className,
			)}
			{...props}
		/>
	);
}

export { Input };
