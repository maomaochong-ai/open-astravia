import type { JSX, ReactNode } from "react";
import { Button, cn } from "@vetta/ui";
import { InputField } from "./SettingsFormFields";

export interface PresetProviderRowModelView {
	readonly displayName: string;
	readonly icon?: string;
	readonly isExpanded: boolean;
	readonly isOpen: boolean;
	readonly adopted: boolean;
	readonly offline: boolean;
	readonly models: readonly unknown[];
	readonly refreshing: boolean;
	readonly hasApiKey: boolean;
	readonly statusLabel: string | null;
	readonly modelsError: string | null;
}

export interface PresetProviderRowViewLabels {
	readonly collapseModels: string;
	readonly viewModels: string;
	readonly enabled: string;
	readonly deprecated: string;
	readonly modelsCount: (count: number) => string;
	readonly collapse: string;
	readonly changeKey: string;
	readonly remove: string;
	readonly enable: string;
	readonly apiKeyDirect: (name: string) => string;
	readonly apiKeyPlaceholder: string;
	readonly encryptedApiKeyPlaceholder: string;
	readonly save: string;
	readonly refreshModels: string;
	readonly refreshingModels: string;
	readonly copyApiKey: string;
}

export interface PresetProviderRowViewProps {
	readonly row: PresetProviderRowModelView;
	readonly draftKey: string;
	readonly saving: boolean;
	readonly labels: PresetProviderRowViewLabels;
	readonly onToggleExpanded: () => void;
	readonly onToggleEditor: () => void;
	readonly onDraftKeyChange: (key: string) => void;
	readonly onAdopt: () => void;
	readonly onRemove: () => void;
	readonly onRefreshModels: () => void;
	readonly onCopyApiKey: () => void;
	readonly icon: ReactNode;
	readonly modelsList?: ReactNode;
}

export function PresetProviderRowView({
	row,
	draftKey,
	saving,
	labels,
	onToggleExpanded,
	onToggleEditor,
	onDraftKeyChange,
	onAdopt,
	onRemove,
	onRefreshModels,
	onCopyApiKey,
	icon,
	modelsList,
}: PresetProviderRowViewProps): JSX.Element {
	// 已下线的旧条目不在内置目录里,给不了 key 也拉不到模型。
	const canEditKey = !row.offline;

	const tryAdopt = (): void => {
		if (draftKey.trim() && !saving) onAdopt();
	};

	return (
		<div className="border-b border-border last:border-b-0">
			<div className="flex items-center gap-3 px-5 py-3.5">
				<button
					type="button"
					onClick={onToggleExpanded}
					className="flex min-w-0 flex-1 items-center gap-3 text-left"
					title={row.isExpanded ? labels.collapseModels : labels.viewModels}
				>
					<span
						className={cn(
							"icon-[mdi--chevron-right] h-4 w-4 shrink-0 text-muted-foreground transition-transform",
							row.isExpanded && "rotate-90",
						)}
					/>
					{icon}
					<div className="min-w-0 flex-1">
						<div className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-foreground">
							<span className="truncate">{row.displayName}</span>
							{row.adopted && (
								<span className="shrink-0 whitespace-nowrap rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-medium text-primary">
									{labels.enabled}
								</span>
							)}
							{row.offline && (
								<span className="shrink-0 whitespace-nowrap rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium text-amber-400">
									{labels.deprecated}
								</span>
							)}
						</div>
						<div className="mt-0.5 truncate text-[11px] text-muted-foreground">
							{labels.modelsCount(row.models.length)}
							{row.statusLabel ? ` · ${row.statusLabel}` : ""}
						</div>
						{row.modelsError && (
							<div className="mt-0.5 truncate text-[11px] text-amber-400">{row.modelsError}</div>
						)}
					</div>
				</button>

				<div className="ml-auto flex shrink-0 items-center gap-1">
					{row.adopted && !row.offline && (
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={onRefreshModels}
							disabled={row.refreshing}
							title={row.refreshing ? labels.refreshingModels : labels.refreshModels}
							className="text-muted-foreground hover:text-foreground"
						>
							<span className={cn("icon-[mdi--refresh] h-3.5 w-3.5", row.refreshing && "animate-spin")} />
						</Button>
					)}
					{/* key 输入合进这一个图标:行内常驻输入框 + 启用按钮太占地方,点开才展开面板。 */}
					{canEditKey && (
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={onToggleEditor}
							title={row.isOpen ? labels.collapse : row.adopted ? labels.changeKey : labels.enable}
							aria-label={row.isOpen ? labels.collapse : row.adopted ? labels.changeKey : labels.enable}
							className={cn(
								"text-muted-foreground hover:text-foreground",
								row.isOpen && "text-foreground",
								!row.adopted && "hover:text-primary",
							)}
						>
							<span
								className={cn(
									"h-3.5 w-3.5",
									row.adopted ? "icon-[mdi--key-outline]" : "icon-[mdi--key-plus]",
								)}
							/>
						</Button>
					)}
					{row.adopted && (
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={onRemove}
							title={labels.remove}
							aria-label={labels.remove}
							className="text-muted-foreground hover:text-destructive"
						>
							<span className="icon-[mdi--delete-outline] h-3.5 w-3.5" />
						</Button>
					)}
					{row.offline && !row.adopted && (
						<span className="text-[11px] text-muted-foreground">{labels.deprecated}</span>
					)}
				</div>
			</div>

			{canEditKey && row.isOpen && (
				<div className="border-t border-border bg-secondary/40 px-5 py-3">
					<label className="mb-1 block text-[11px] text-muted-foreground">
						{labels.apiKeyDirect(row.displayName)}
					</label>
					<div className="flex items-center gap-2">
						<div className="flex-1">
							<InputField
								value={draftKey}
								onChange={onDraftKeyChange}
								placeholder={row.hasApiKey ? labels.encryptedApiKeyPlaceholder : labels.apiKeyPlaceholder}
								type="password"
								disabled={saving}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										tryAdopt();
									}
								}}
							/>
						</div>
						{row.hasApiKey && (
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={onCopyApiKey}
								title={labels.copyApiKey}
								aria-label={labels.copyApiKey}
							>
								<span className="icon-[mdi--content-copy] h-3.5 w-3.5" />
							</Button>
						)}
						<Button
							variant="primary"
							size="sm"
							onClick={tryAdopt}
							disabled={!draftKey.trim() || saving}
						>
							{row.adopted ? labels.changeKey : labels.enable}
						</Button>
					</div>
				</div>
			)}

			{row.isExpanded && modelsList}
		</div>
	);
}
