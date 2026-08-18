import { useTranslation } from "react-i18next";
import { Button, cn } from "@vetta/ui";
import type { ModelsSettingsModel } from "./useModelsSettingsModel";

/** 展示 `GET {baseUrl}/models` 拉取到的模型 id，勾选后批量写入 provider。 */
export function ModelsFetchedModelsPanel({
	name,
	model,
}: {
	name: string;
	model: ModelsSettingsModel;
}): JSX.Element | null {
	const { t } = useTranslation("settings");
	const fetched = model.fetchedModels;
	if (!fetched || fetched.provider !== name) return null;

	const existing = new Set((model.config?.providers[name]?.models || []).map((item) => item.id));

	return (
		<div className="border-t border-border/50 bg-secondary/50 px-5 py-3">
			{fetched.error ? (
				<div className="text-[12px] text-destructive">{fetched.error}</div>
			) : (
				<>
					<div className="mb-2 text-[11px] text-muted-foreground">
						{t("fetchedModelsHint", { n: fetched.models.length })}
					</div>
					<div className="max-h-56 overflow-y-auto rounded border border-border">
						{fetched.models.map((id) => {
							const isSelected = fetched.selected.includes(id);
							const isExisting = existing.has(id);
							return (
								<button
									key={id}
									type="button"
									onClick={() => model.onToggleFetchedModel(id)}
									className="flex w-full items-center gap-2 border-b border-border/50 px-3 py-1.5 text-left last:border-b-0 hover:bg-accent"
								>
									<span
										className={cn(
											"h-3.5 w-3.5 shrink-0",
											isSelected
												? "icon-[mdi--checkbox-marked] text-primary"
												: "icon-[mdi--checkbox-blank-outline] text-muted-foreground",
										)}
									/>
									<span className="min-w-0 flex-1 truncate text-[12px] text-foreground">{id}</span>
									{isExisting && <span className="text-[10px] text-muted-foreground">{t("alreadyAdded")}</span>}
								</button>
							);
						})}
					</div>
				</>
			)}
			<div className="mt-3 flex items-center gap-2">
				{!fetched.error && (
					<Button
						size="sm"
						onClick={() => void model.onApplyFetchedModels(name)}
						disabled={model.saving || fetched.selected.length === 0}
					>
						{t("addSelectedModels", { n: fetched.selected.length })}
					</Button>
				)}
				<Button variant="ghost" size="sm" onClick={model.onCancelFetchedModels}>
					{t("cancel")}
				</Button>
			</div>
		</div>
	);
}
