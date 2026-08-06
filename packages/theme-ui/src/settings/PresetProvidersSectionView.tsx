import type { JSX, ReactNode } from "react";
import { Button, cn } from "@vetta/ui";
import { SettingSection, type SettingSectionMeta } from "./SettingChrome";

export interface PresetProvidersSectionViewLabels {
	readonly title: string;
	readonly loading: string;
	readonly noPresetProviders: string;
	readonly refreshCatalog: string;
}

export interface PresetProvidersSectionViewProps {
	readonly section: SettingSectionMeta;
	readonly labels: PresetProvidersSectionViewLabels;
	readonly error: string | null;
	readonly hasRows: boolean;
	readonly loading: boolean;
	readonly rows: ReactNode;
	readonly refreshingCatalog: boolean;
	readonly onRefreshCatalog: () => void;
}

export function PresetProvidersSectionView({
	section,
	labels,
	error,
	hasRows,
	loading,
	rows,
	refreshingCatalog,
	onRefreshCatalog,
}: PresetProvidersSectionViewProps): JSX.Element {
	return (
		<div className="mt-6">
			<SettingSection
				section={section}
				title={
					<div className="flex items-center justify-between gap-3">
						<span>{labels.title}</span>
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={onRefreshCatalog}
							disabled={refreshingCatalog}
							title={labels.refreshCatalog}
							aria-label={labels.refreshCatalog}
							className="text-muted-foreground hover:text-foreground"
						>
							<span className={cn("icon-[mdi--refresh] h-4 w-4", refreshingCatalog && "animate-spin")} />
						</Button>
					</div>
				}
			>
				{/* 有行也要显示:目录不可达时六家都在、但都是 0 个模型,不说原因用户只能干猜。 */}
				{error && (
					<div className="flex items-start gap-2 border-b border-border px-5 py-3 text-[12px] text-amber-400">
						<span className="icon-[mdi--alert-circle-outline] mt-0.5 h-3.5 w-3.5 shrink-0" />
						<span className="min-w-0">{error}</span>
					</div>
				)}
				{!hasRows && !error && (
					<div className="px-5 py-6 text-center text-[12px] text-muted-foreground">
						{loading ? labels.loading : labels.noPresetProviders}
					</div>
				)}
				{rows}
			</SettingSection>
		</div>
	);
}
