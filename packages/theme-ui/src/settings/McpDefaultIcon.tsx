import type { JSX } from "react";
import { cn } from "@vetta-org/ui";

/** 未配置图标时的 MCP 默认图标：主题色圆角矩形底 + 链环。 */
export function McpDefaultIcon({ className }: { className?: string }): JSX.Element {
	return (
		<span
			className={cn(
				"flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground",
				className,
			)}
			aria-hidden
		>
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-5 w-5" fill="none">
				<path d="M0 0h24v24H0z" fill="none" />
				<path
					fill="currentColor"
					d="M9.795 1.694a4.287 4.287 0 0 1 6.061 0a4.28 4.28 0 0 1 1.181 3.819a4.28 4.28 0 0 1 3.819 1.181a4.287 4.287 0 0 1 0 6.061l-6.793 6.793a.25.25 0 0 0 0 .353l2.617 2.618a.75.75 0 1 1-1.061 1.061l-2.617-2.618a1.75 1.75 0 0 1 0-2.475l6.793-6.793a2.785 2.785 0 1 0-3.939-3.939l-5.9 5.9a.7.7 0 0 1-.249.165a.749.749 0 0 1-.812-1.225l5.9-5.901a2.785 2.785 0 1 0-3.939-3.939L2.931 10.68A.75.75 0 1 1 1.87 9.619z"
				/>
				<path
					fill="currentColor"
					d="M12.42 4.069a.75.75 0 0 1 1.061 0a.75.75 0 0 1 0 1.061L7.33 11.28a2.79 2.79 0 0 0 0 3.94a2.79 2.79 0 0 0 3.94 0l6.15-6.151a.75.75 0 0 1 1.061 0a.75.75 0 0 1 0 1.061l-6.151 6.15a4.285 4.285 0 1 1-6.06-6.06z"
				/>
			</svg>
		</span>
	);
}
