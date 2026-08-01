import { useTranslation } from "react-i18next";
import { ModelsProviderFormView } from "@vetta/theme-ui/settings";
import { Button, cn } from "@vetta/ui";
import { ModelsFetchedModelsPanel } from "./ModelsFetchedModelsPanel";
import { ModelsModelForm } from "./ModelsModelForm";
import { ModelsProviderForm } from "./ModelsProviderForm";
import type { ModelsSettingsModel } from "./useModelsSettingsModel";

export type ModelsProviderRowThemeViews = {
	readonly providerForm: typeof ModelsProviderFormView;
};

export function ModelsProviderRow({
	name,
	model,
}: {
	name: string;
	model: ModelsSettingsModel;
}): JSX.Element | null {
	const { t } = useTranslation("settings");
	const provider = model.config?.providers[name];
	if (!provider) return null;

	const isExpanded = model.expandedProvider === name;
	const isEditing = model.editingProvider === name;
	const models = provider.models || [];

	return (
		<div className="border-b border-border last:border-b-0">
			<div className="flex items-center gap-3 px-5 py-3.5">
				<button
					type="button"
					onClick={() => model.onToggleProvider(name)}
					className="flex flex-1 items-center gap-3 text-left"
				>
					<span
						className={cn(
							"icon-[mdi--chevron-right] h-4 w-4 shrink-0 text-muted-foreground transition-transform",
							isExpanded && "rotate-90",
						)}
					/>
					<div className="min-w-0 flex-1">
						<div className="text-[13px] font-medium text-foreground">{name}</div>
						<div className="mt-0.5 text-[11px] text-muted-foreground">
							{provider.api || "openai-completions"} · {models.length} {t("models")}
							{provider.baseUrl && ` · ${provider.baseUrl}`}
						</div>
					</div>
				</button>
				<div className="flex items-center gap-1">
					{provider.apiKey && (
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={(event) => {
								event.stopPropagation();
								model.onStartEditProvider(name);
								if (!isExpanded) model.onToggleProvider(name);
							}}
							title={t("changeKey")}
							aria-label={t("changeKey")}
						>
							<span className="icon-[mdi--key-change] h-3.5 w-3.5" />
						</Button>
					)}
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={(e) => {
							e.stopPropagation();
							model.onStartEditProvider(name);
							if (!isExpanded) model.onToggleProvider(name);
						}}
						title={t("edit")}
					>
						<span className="icon-[mdi--pencil-outline] h-3.5 w-3.5" />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={(e) => {
							e.stopPropagation();
							void model.onDeleteProvider(name);
						}}
						title={t("delete")}
						className="text-muted-foreground hover:text-destructive"
					>
						<span className="icon-[mdi--delete-outline] h-3.5 w-3.5" />
					</Button>
				</div>
			</div>

			{isExpanded && isEditing && (
				<div className="border-t border-border bg-secondary/50 px-5 py-4">
					<ModelsProviderForm
						form={model.providerForm}
						setForm={model.setProviderForm}
						onSave={() => void model.onUpdateProvider(name)}
						onCancel={model.onCancelEditProvider}
						saving={model.saving}
						saveLabel={t("save")}
						replacingApiKey={Boolean(provider.apiKey)}
						onCopyApiKey={provider.apiKey ? () => void model.onCopyProviderApiKey(name) : undefined}
					/>
				</div>
			)}

			{isExpanded && !isEditing && (
				<div className="border-t border-border bg-secondary/30">
					{models.length === 0 && model.addingModelFor !== name && (
						<div className="px-5 py-6 text-center text-[12px] text-muted-foreground">{t("noCustomModels")}</div>
					)}

					{models.map((item) => {
						const modelKey = `${name}/${item.id}`;
						const isDefault = model.config?.defaultModel === modelKey;
						const isModelEditing = model.editingModel?.provider === name && model.editingModel?.modelId === item.id;

						if (isModelEditing) {
							return (
								<div key={item.id} className="border-b border-border/50 px-5 py-3 last:border-b-0">
									<ModelsModelForm
										form={model.modelForm}
										setForm={model.setModelForm}
										onSave={() => void model.onUpdateModel(name, item.id)}
										onCancel={model.onCancelEditModel}
										saving={model.saving}
										saveLabel={t("save")}
									/>
								</div>
							);
						}

						return (
							<div
								key={item.id}
								className="flex items-center justify-between border-b border-border/50 px-5 py-2.5 last:border-b-0"
							>
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2 text-[12px] font-medium text-foreground">
										{item.name || item.id}
										{isDefault && (
											<span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-medium text-primary">
												{t("default")}
											</span>
										)}
									</div>
									<div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
										<span>{item.id}</span>
										{item.api && <span>· {item.api}</span>}
										{item.input?.includes("image") && (
											<span className="rounded bg-primary/10 px-1 py-0.5 text-[9px] text-primary">vision</span>
										)}
										{item.reasoning && (
											<span className="rounded bg-accent px-1 py-0.5 text-[9px] text-muted-foreground">reasoning</span>
										)}
										{item.contextWindow != null && <span>· {(item.contextWindow / 1024).toFixed(0)}K ctx</span>}
										{item.maxTokens != null && <span>· {(item.maxTokens / 1024).toFixed(0)}K max</span>}
									</div>
								</div>
								<div className="flex items-center gap-0.5">
									<Button
										variant="ghost"
										size="icon-xs"
										onClick={() => void model.onSetDefaultModel(name, item.id)}
										className={isDefault ? "text-primary" : "text-muted-foreground hover:text-primary"}
										title={isDefault ? t("unsetDefault") : t("setDefault")}
									>
										<span className={`${isDefault ? "icon-[mdi--star]" : "icon-[mdi--star-outline]"} h-3.5 w-3.5`} />
									</Button>
									<Button
										variant="ghost"
										size="icon-xs"
										onClick={() => model.onStartEditModel(name, item.id)}
										title={t("editModel")}
									>
										<span className="icon-[mdi--pencil-outline] h-3 w-3" />
									</Button>
									<Button
										variant="ghost"
										size="icon-xs"
										onClick={() => void model.onDeleteModel(name, item.id)}
										title={t("deleteModel")}
										className="text-muted-foreground hover:text-destructive"
									>
										<span className="icon-[mdi--close] h-3 w-3" />
									</Button>
								</div>
							</div>
						);
					})}

					<ModelsFetchedModelsPanel name={name} model={model} />

					{model.addingModelFor === name ? (
						<div className="border-t border-border/50 px-5 py-3">
							<ModelsModelForm
								form={model.modelForm}
								setForm={model.setModelForm}
								onSave={() => void model.onAddModel(name)}
								onCancel={model.onCancelAddModel}
								saving={model.saving}
								saveLabel={t("add")}
							/>
						</div>
					) : (
						<div className="flex items-center gap-1 border-t border-border/50 px-5 py-2">
							<Button variant="ghost" size="sm" onClick={() => model.onStartAddModel(name)}>
								<span className="icon-[mdi--plus] h-3.5 w-3.5" />
								{t("addModel")}
							</Button>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => void model.onFetchProviderModels(name)}
								disabled={!provider.baseUrl || model.fetchingModelsFor === name}
								title={provider.baseUrl ? undefined : t("fetchModelsNeedsBaseUrl")}
							>
								<span
									className={cn(
										"h-3.5 w-3.5",
										model.fetchingModelsFor === name
											? "icon-[mdi--loading] animate-spin"
											: "icon-[mdi--cloud-download-outline]",
									)}
								/>
								{t("fetchModels")}
							</Button>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
