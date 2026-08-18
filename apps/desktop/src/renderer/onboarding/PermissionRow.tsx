import { cn } from "@shared/lib/utils";

interface PermissionRowProps {
	title: string;
	description: string;
	granted: boolean;
	loading: boolean;
	buttonLabel: string;
	doneLabel: string;
	onOpenPane: () => void;
}

/** 单项权限行：名称 + 说明 + 实时状态点 + 「前往系统设置」按钮，已授权时显示 Done✓。 */
export function PermissionRow({
	title,
	description,
	granted,
	loading,
	buttonLabel,
	doneLabel,
	onOpenPane,
}: PermissionRowProps): JSX.Element {
	return (
		<div className="flex items-center justify-between gap-3 py-3">
			<div className="min-w-0">
				<div className="flex items-center gap-2">
					<span
						className={cn(
							"h-1.5 w-1.5 shrink-0 rounded-full",
							loading ? "bg-muted-foreground/50" : granted ? "bg-emerald-500" : "bg-amber-500",
						)}
					/>
					<span className="truncate text-[13px] font-medium text-foreground">{title}</span>
				</div>
				<p className="mt-0.5 truncate text-[12px] text-muted-foreground">{description}</p>
			</div>
			{granted ? (
				<span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-emerald-500">
					<span className="icon-[mdi--check-circle] h-4 w-4" />
					{doneLabel}
				</span>
			) : (
				<button
					type="button"
					onClick={onOpenPane}
					className="flex shrink-0 items-center gap-1.5 rounded-lg border border-input bg-secondary px-3 py-1.5 text-[12px] text-foreground transition-colors hover:bg-accent"
				>
					<span className="icon-[mdi--open-in-new] h-3.5 w-3.5 text-muted-foreground" />
					{buttonLabel}
				</button>
			)}
		</div>
	);
}
