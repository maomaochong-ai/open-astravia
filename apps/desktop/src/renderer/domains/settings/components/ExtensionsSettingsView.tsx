import type { ExtensionEntryModel, ExtensionsSettingsModel } from "./useExtensionsSettingsModel";

function ExtensionIcon({ entry }: { entry: ExtensionEntryModel }): JSX.Element {
	// 原色图标按原样渲染；单色 class 图标跟随主题前景色，与侧边栏入口一致。
	if (entry.iconUrl) return <img src={entry.iconUrl} alt="" className="size-5 shrink-0 object-contain" />;
	return <span className={`${entry.icon} size-5 shrink-0 text-muted-foreground`} aria-hidden="true" />;
}

function ExtensionCard({ entry }: { entry: ExtensionEntryModel }): JSX.Element {
	return (
		<button
			type="button"
			onClick={entry.open}
			title={`${entry.label} · ${entry.subtitle}`}
			className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-border/50 bg-card/40 p-3.5 text-left outline-none transition-colors duration-200 hover:border-primary/40 hover:bg-card/60 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
		>
			<span className="flex size-9 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--foreground)_7%,transparent)]">
				<ExtensionIcon entry={entry} />
			</span>
			<span className="flex min-w-0 flex-col gap-1">
				<span className="truncate text-[13px] font-semibold text-foreground">{entry.label}</span>
				<span className="truncate text-[12px] text-muted-foreground">{entry.subtitle}</span>
			</span>
		</button>
	);
}

/** 扩展设置：把插件自己的工作区页面列成入口，点击直达；这里不承载任何插件配置。 */
export function ExtensionsSettingsView({ model }: { model: ExtensionsSettingsModel }): JSX.Element {
	return (
		<div className="mx-auto w-full max-w-[680px] px-8 pt-2 pb-4">
			<h1 className="mb-2 text-[20px] font-bold text-foreground">{model.labels.title}</h1>
			<p className="mb-6 text-[12px] leading-relaxed text-muted-foreground">{model.labels.description}</p>

			{model.entries.length === 0 ? (
				<div className="rounded-xl border border-dashed border-border bg-card/20 px-5 py-6 text-center">
					<p className="text-[13px] text-foreground">{model.labels.empty}</p>
					<p className="mt-1 text-[12px] text-muted-foreground">{model.labels.emptyHint}</p>
				</div>
			) : (
				<div className="grid grid-cols-3 gap-3">
					{model.entries.map((entry) => (
						<ExtensionCard key={entry.key} entry={entry} />
					))}
				</div>
			)}
		</div>
	);
}
