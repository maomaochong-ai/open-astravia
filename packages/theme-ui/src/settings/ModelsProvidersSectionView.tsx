import type { JSX, ReactNode } from "react";
import { Button } from "@vetta-org/ui";
import type { SettingSectionMeta } from "./SettingChrome";

export interface ModelsProvidersSectionViewLabels {
	readonly localProviders: string;
	readonly addProvider: string;
	readonly noProvidersAdded: string;
}

export interface ModelsProvidersSectionViewProps {
	readonly section: SettingSectionMeta;
	readonly labels: ModelsProvidersSectionViewLabels;
	readonly showAddButton: boolean;
	readonly onStartAdd: () => void;
	readonly empty: boolean;
	readonly rows: ReactNode;
}

/**
 * 「本地服务商」section 壳层：脱离 SettingSection 的整块表格容器，改为标题行 + 独立
 * 服务商卡片的自由布局。高亮定位所需的 data 属性保持与 SettingSection 同款。
 */
export function ModelsProvidersSectionView({
	section,
	labels,
	showAddButton,
	onStartAdd,
	empty,
	rows,
}: ModelsProvidersSectionViewProps): JSX.Element {
	return (
		<div className="mb-6 p-1.5" data-setting-section-highlight-target={section.id}>
			<div className="mb-3 flex items-center justify-between gap-3 px-1">
				<h2 id={section.id} className="text-[15px] font-semibold text-foreground">
					{labels.localProviders}
				</h2>
				{showAddButton && (
					<Button variant="ghost" size="sm" onClick={onStartAdd}>
						<span className="icon-[mdi--plus] h-3.5 w-3.5" />
						{labels.addProvider}
					</Button>
				)}
			</div>
			<div className="flex flex-col gap-2.5" data-setting-section-id={section.id}>
				{empty && showAddButton && (
					<div className="rounded-xl border border-dashed border-border/70 bg-card/40 px-5 py-8 text-center text-[12px] text-muted-foreground">
						{labels.noProvidersAdded}
					</div>
				)}
				{rows}
			</div>
		</div>
	);
}
