import { cn } from "@astravia-org/ui/utils";
import type { CommandPanelDetailModel } from "./types";

/**
 * 右栏详情。
 *
 * 名称与来源在列表里已经被高亮项表达过一次，这里只补列表看不全的那几条：描述、
 * 状态、插入方式与一句「接下来会发生什么」。动作固定在底部，视线不必来回扫。
 *
 * 没有高亮项时**整栏不渲染**（由调用方决定），不留空白列——与模型选择器
 * 「没有档位就不出第三栏」同一条规则。
 */
export function AddPanelDetailView({
	detail,
	onActivate,
	onSecondary,
}: {
	readonly detail: CommandPanelDetailModel;
	readonly onActivate: () => void;
	readonly onSecondary?: () => void;
}): JSX.Element {
	return (
		<div className="flex w-[232px] shrink-0 flex-col gap-2.5 border-l border-border/40 p-3">
			<div className="flex items-center gap-2.5">
				<span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/40 bg-foreground/5">
					{detail.primaryIconUrl ? (
						<img src={detail.primaryIconUrl} alt="" className="size-4 object-contain" draggable={false} />
					) : (
						<span aria-hidden="true" className={cn(detail.primaryIcon ?? "icon-[solar--widget-linear]", "size-4")} />
					)}
				</span>
				<span className="min-w-0">
					<span className="block truncate text-[12.5px] font-semibold leading-tight text-foreground">
						{detail.label}
					</span>
					<span className="mt-0.5 block truncate text-[10px] text-muted-foreground/80">{detail.subtitle}</span>
				</span>
			</div>

			{detail.description && (
				<p className="line-clamp-3 text-[11px] leading-relaxed text-foreground/70">{detail.description}</p>
			)}

			{detail.meta.length > 0 && (
				<dl className="flex flex-col gap-1.5">
					{detail.meta.map((row) => (
						<div key={row.label} className="flex items-baseline justify-between gap-2">
							<dt className="shrink-0 text-[10px] text-muted-foreground/70">{row.label}</dt>
							<dd className="min-w-0 truncate text-right text-[10.5px] text-foreground/80">{row.value}</dd>
						</div>
					))}
				</dl>
			)}

			{detail.hint && <p className="text-[10px] leading-relaxed text-muted-foreground/70">{detail.hint}</p>}

			<div className="mt-auto flex flex-col gap-1.5">
				<button
					type="button"
					onClick={onActivate}
					className="flex h-7 items-center justify-center gap-1.5 rounded-md bg-primary text-[11.5px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
				>
					{detail.primaryLabel}
					<kbd className="rounded bg-primary-foreground/20 px-1 text-[9.5px] font-normal leading-4">Enter</kbd>
				</button>
				{detail.secondaryLabel && onSecondary && (
					<button
						type="button"
						onClick={onSecondary}
						className="flex h-6.5 items-center justify-center rounded-md border border-border/60 text-[10.5px] text-foreground/75 transition-colors hover:bg-foreground/5"
					>
						{detail.secondaryLabel}
					</button>
				)}
			</div>
		</div>
	);
}
