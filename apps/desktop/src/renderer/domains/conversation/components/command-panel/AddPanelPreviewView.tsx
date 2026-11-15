import { AddPanelIcon } from "./AddPanelIcon";
import type { CommandPanelLabels, CommandPanelPreviewModel } from "./types";

/**
 * 条目预览页（占满中栏，替换列表；不是右侧第三栏）。
 *
 * 三栏时右栏只有 232px，长描述被截成两三行、名称与来源还要和列表里重复一遍；
 * 而右栏底部那颗「插入到输入框」又和「点这一行就插入」重复，还是面板里唯一一颗
 * 实心主色按钮，在半透明表面上非常扎眼。
 *
 * 现在预览只回答「它是什么」：图标、名称、来源、状态、插入方式、一句后果说明。
 * 没有动作按钮——要插入就点列表里的那一行（ADR-0175 §2）。
 */
export function AddPanelPreviewView({
	preview,
	labels,
	onBack,
}: {
	readonly preview: CommandPanelPreviewModel;
	readonly labels: CommandPanelLabels;
	readonly onBack: () => void;
}): JSX.Element {
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex shrink-0 items-center gap-1 px-1 pb-1 pt-1">
				<button
					type="button"
					onClick={onBack}
					aria-label={labels.preview.back}
					title={labels.preview.back}
					className="flex h-7 items-center gap-1 rounded-md pl-1 pr-2 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/8 hover:text-foreground"
				>
					<span aria-hidden="true" className="icon-[solar--alt-arrow-left-linear] size-3.5" />
					{labels.preview.back}
				</button>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
				<div className="flex items-center gap-2.5 pt-1">
					<AddPanelIcon
						icon={preview.icon}
						iconUrl={preview.iconUrl}
						fallbackIcon={preview.fallbackIcon}
						type={preview.kind}
						boxClassName="size-9 rounded-lg border border-border/40 bg-foreground/5"
						className="size-4"
					/>
					<span className="min-w-0">
						<span className="block break-words text-[13px] font-semibold leading-snug text-foreground">
							{preview.label}
						</span>
						<span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground/80">{preview.subtitle}</span>
					</span>
				</div>

				{preview.description && (
					<p className="mt-3 select-text break-words text-[11.5px] leading-relaxed text-foreground/75">
						{preview.description}
					</p>
				)}

				{preview.meta.length > 0 && (
					<dl className="mt-3 flex flex-col gap-2">
						{preview.meta.map((row) => (
							<div key={row.label} className="flex items-baseline justify-between gap-3">
								<dt className="shrink-0 text-[10px] text-muted-foreground/70">{row.label}</dt>
								<dd className="min-w-0 select-text break-all text-right text-[10.5px] text-foreground/85">{row.value}</dd>
							</div>
						))}
					</dl>
				)}

			</div>
		</div>
	);
}
