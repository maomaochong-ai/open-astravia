import type { ExtensionEntryModel, ExtensionsSettingsModel } from "./useExtensionsSettingsModel";

function ExtensionIcon({ entry }: { entry: ExtensionEntryModel }): JSX.Element {
	// 原色图标按原样渲染；单色 class 图标跟随主题前景色，hover 时随行转主色。
	if (entry.iconUrl) return <img src={entry.iconUrl} alt="" className="size-[18px] shrink-0 object-contain" />;
	return <span className={`${entry.icon} size-[18px] shrink-0`} aria-hidden="true" />;
}

/**
 * 入口行。
 *
 * 描述固定占两行高度（`line-clamp-2` + `min-h`）：插件说明长短不一，不锁行高时列表
 * 会参差不齐；`min-w-0` 与 `overflow-hidden` 一起挡住 flex item 的 `min-width:auto`
 * —— 少了它长文案会把行撑破并溢出到容器外。
 */
function ExtensionRow({ entry }: { entry: ExtensionEntryModel }): JSX.Element {
	return (
		<button
			type="button"
			onClick={entry.open}
			title={entry.description ? `${entry.label} · ${entry.description}` : `${entry.label} · ${entry.pluginName}`}
			className="group flex w-full min-w-0 items-center gap-3 overflow-hidden px-3.5 py-3 text-left outline-none transition-colors duration-200 hover:bg-accent/40 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
		>
			<span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[color-mix(in_oklab,var(--foreground)_7%,transparent)] text-muted-foreground transition-colors duration-200 group-hover:bg-primary/12 group-hover:text-primary">
				<ExtensionIcon entry={entry} />
			</span>

			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="flex min-w-0 items-center gap-2">
					<span className="truncate text-[13px] font-semibold text-foreground">{entry.label}</span>
					{/* 描述来自视图自己时，插件归属跟在标题后，避免用户认错提供方。 */}
					{entry.description ? (
						<span className="shrink-0 rounded-full bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)] px-1.5 py-px text-[10px] leading-tight text-muted-foreground">
							{entry.pluginName}
						</span>
					) : null}
				</span>
				<span className="line-clamp-2 min-h-[2lh] text-[12px] leading-[1.4] text-muted-foreground">
					{entry.description || entry.pluginName}
				</span>
			</span>

			<span
				className="icon-[solar--alt-arrow-right-linear] size-4 shrink-0 text-muted-foreground/60 transition-colors duration-200 group-hover:text-primary"
				aria-hidden="true"
			/>
		</button>
	);
}

/** 扩展增强：把插件自己的工作区页面列成入口，点击直达；这里不承载任何插件配置。 */
export function ExtensionsSettingsView({ model }: { model: ExtensionsSettingsModel }): JSX.Element {
	return (
		<div className="mx-auto w-full max-w-[680px] px-8 pt-2 pb-4">
			<h1 className="mb-2 text-[20px] font-bold text-foreground">{model.labels.title}</h1>
			<p className="mb-6 text-[12px] leading-relaxed text-muted-foreground">{model.labels.description}</p>

			{model.entries.length === 0 ? (
				<div className="rounded-xl border border-dashed border-border bg-card/20 px-5 py-8 text-center">
					<span
						className="icon-[solar--widget-2-linear] mx-auto mb-3 block size-6 text-muted-foreground/60"
						aria-hidden="true"
					/>
					<p className="text-[13px] text-foreground">{model.labels.empty}</p>
					<p className="mt-1 text-[12px] text-muted-foreground">{model.labels.emptyHint}</p>
				</div>
			) : (
				<>
					<div className="mb-3 flex items-baseline gap-2">
						<h2 className="text-[15px] font-semibold text-foreground">{model.labels.sectionTitle}</h2>
						<span className="text-[12px] text-muted-foreground">{model.labels.count}</span>
					</div>
					{/* 行之间只用发丝线分隔，整块是一张卡：比逐行描边更安静，也更像设置表。 */}
					<div className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60 bg-card/40">
						{model.entries.map((entry) => (
							<ExtensionRow key={entry.key} entry={entry} />
						))}
					</div>
				</>
			)}
		</div>
	);
}
