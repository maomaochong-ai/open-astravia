import { ProviderIcon } from "@vetta-org/theme-ui/shared";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, cn } from "@vetta-org/ui";
import { confirmDialogAtom } from "@shared/store/atoms";
import { useSetAtom } from "jotai";
import type { ModelsSettingsModel } from "./useModelsSettingsModel";

/** 展开面板每次展示的模型数量；超出部分收进「查看更多」。 */
export const MODEL_PAGE_SIZE = 10;

/** baseUrl 去掉协议与末尾斜杠，meta 行里只留主机与路径，降噪。 */
function displayHost(baseUrl: string | undefined): string {
	if (!baseUrl) return "";
	return baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function ModelsProviderRow({
	name,
	model,
}: {
	name: string;
	model: ModelsSettingsModel;
}): JSX.Element | null {
	const { t } = useTranslation("settings");
	const setConfirm = useSetAtom(confirmDialogAtom);
	const provider = model.config?.providers[name];
	if (!provider) return null;

	const isExpanded = model.expandedProvider === name;
	const models = provider.models || [];
	const host = displayHost(provider.baseUrl);
	const [visibleCount, setVisibleCount] = useState(MODEL_PAGE_SIZE);

	// 收起后重置分页：再次展开总是从头看，避免记着上次翻到一半的位置。
	useEffect(() => {
		if (!isExpanded) setVisibleCount(MODEL_PAGE_SIZE);
	}, [isExpanded]);
	const visibleModels = models.slice(0, visibleCount);
	const remaining = models.length - visibleCount;
	return (
		<div
			className={cn(
				"overflow-hidden rounded-xl border border-border bg-card shadow-xs transition-colors",
				isExpanded && "border-border/80",
			)}
		>
			{/* 卡片头：折叠箭头 + 图标 + 名称与 meta；右侧紧凑操作。 */}
			<div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
				<button
					type="button"
					onClick={() => model.onToggleProvider(name)}
					className="flex min-w-0 items-center gap-3 text-left"
					title={name}
				>
					<span
						className={cn(
							"icon-[mdi--chevron-right] h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform duration-150",
							isExpanded && "rotate-90",
						)}
						aria-hidden="true"
					/>
					<span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-secondary/60">
						{provider.icon ? (
							<ProviderIcon symbol={provider.icon} className="h-5 w-5" />
						) : (
							<span className="icon-[mdi--server-outline] h-4 w-4 text-muted-foreground/70" aria-hidden="true" />
						)}
					</span>
					<div className="min-w-0 flex-1">
						<div className="truncate text-[13px] font-medium text-foreground">{name}</div>
						<div className="mt-0.5 truncate text-[11px] text-muted-foreground/85">
							{provider.api || "openai-completions"} · {models.length} {t("models")}
							{host && <span className="font-mono text-[10.5px]"> · {host}</span>}
						</div>
					</div>
				</button>
				<div className="flex items-center gap-0.5">
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={(e) => {
							e.stopPropagation();
							model.onStartAddModel(name);
						}}
						title={t("addModel")}
						aria-label={t("addModel")}
						className="text-muted-foreground/80 hover:text-foreground"
					>
						<span className="icon-[mdi--plus] h-4 w-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={(e) => {
							e.stopPropagation();
							model.onStartEditProvider(name);
						}}
						title={t("editProvider")}
						aria-label={t("editProvider")}
						className="text-muted-foreground/80 hover:text-foreground"
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
						aria-label={t("delete")}
						className="text-muted-foreground/80 hover:text-destructive"
					>
						<span className="icon-[mdi--delete-outline] h-3.5 w-3.5" />
					</Button>
				</div>
			</div>

			{isExpanded && (
				<div className="px-4 pb-3.5">
					<div className="rounded-lg border border-border/40 bg-secondary/40 p-1">
						{models.length === 0 && (
							<div className="px-3 py-5 text-center text-[11.5px] text-muted-foreground/80">
								{t("noCustomModels")}
							</div>
						)}

							{visibleModels.length > 0 && (
							<div className="space-y-px">
								{visibleModels.map((item) => {
									const modelKey = `${name}/${item.id}`;
									const isDefault = model.config?.defaultModel === modelKey;
									const displayName = item.name || item.id;

									return (
										<div
											key={item.id}
											className="group flex items-center gap-3 rounded-md px-2.5 py-1.5 transition-colors hover:bg-accent/40"
										>
											<div className="min-w-0 flex-1">
												<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
													<span className="truncate text-[12px] font-medium text-foreground" title={displayName}>
														{displayName}
													</span>
													{isDefault && (
														<span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-px text-[9px] font-medium text-primary">
															{t("default")}
														</span>
													)}
													{item.input?.includes("image") && (
														<span className="shrink-0 rounded bg-primary/10 px-1 py-px text-[9px] text-primary">
															{t("vision")}
														</span>
													)}
													{item.reasoning && (
														<span className="shrink-0 rounded bg-accent px-1 py-px text-[9px] text-muted-foreground">
															{t("thinking")}
														</span>
													)}
												</div>
												<div className="mt-px flex items-center gap-2 truncate text-[10.5px] text-muted-foreground/70">
													<span className="truncate font-mono" title={item.id}>
														{item.id}
													</span>
													{item.contextWindow != null && (
														<span className="shrink-0">{(item.contextWindow / 1024).toFixed(0)}K ctx</span>
													)}
													{item.maxTokens != null && (
														<span className="shrink-0">{(item.maxTokens / 1024).toFixed(0)}K max</span>
													)}
												</div>
											</div>
											<div className="flex shrink-0 items-center gap-0.5">
												<Button
													variant="ghost"
													size="icon-xs"
													onClick={() => void model.onSetDefaultModel(name, item.id)}
													className={cn(
														"transition-opacity",
														isDefault
															? "text-primary opacity-100"
															: "text-muted-foreground opacity-0 hover:text-primary group-hover:opacity-100 focus-visible:opacity-100",
													)}
													title={isDefault ? t("unsetDefault") : t("setDefault")}
													aria-label={isDefault ? t("unsetDefault") : t("setDefault")}
												>
													<span className={`${isDefault ? "icon-[mdi--star]" : "icon-[mdi--star-outline]"} h-3.5 w-3.5`} />
												</Button>
												<Button
													variant="ghost"
													size="icon-xs"
													onClick={() => model.onStartEditModel(name, item.id)}
													className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
													title={t("editModel")}
													aria-label={t("editModel")}
												>
													<span className="icon-[mdi--pencil-outline] h-3 w-3" />
												</Button>
												<Button
													variant="ghost"
													size="icon-xs"
													onClick={() => void model.onDeleteModel(name, item.id)}
													className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
													title={t("deleteModel")}
													aria-label={t("deleteModel")}
												>
													<span className="icon-[mdi--close] h-3 w-3" />
												</Button>
											</div>
										</div>
									);
								})}
							</div>
						)}

							{remaining > 0 && (
								<button
									type="button"
									onClick={() => setVisibleCount((count) => count + MODEL_PAGE_SIZE)}
									className="mt-0.5 flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
								>
									<span className="icon-[mdi--chevron-down] h-3.5 w-3.5" aria-hidden="true" />
									{t("showMoreModels", { n: remaining })}
								</button>
							)}

							<div className="flex items-center gap-1 px-1.5 pb-0.5 pt-1">
							<Button
								variant="ghost"
								size="sm"
								onClick={() => model.onStartAddModel(name)}
								className="h-7 gap-1.5 px-2 text-[11.5px] text-muted-foreground hover:text-foreground"
							>
								<span className="icon-[mdi--plus] h-3.5 w-3.5" />
								{t("addModel")}
							</Button>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => model.onStartFetchProviderModels(name)}
								disabled={!provider.baseUrl || model.fetchingModelsFor === name}
								title={provider.baseUrl ? undefined : t("fetchModelsNeedsBaseUrl")}
								className="h-7 gap-1.5 px-2 text-[11.5px] text-muted-foreground hover:text-foreground"
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
							<Button
								variant="ghost"
								size="sm"
								onClick={() => {
									// 二次确认在这里组装：弹层是全局根组件，确认后才真正清空。
									setConfirm({
										title: t("clearModels"),
										message: t("clearModelsConfirmMessage", { name, n: models.length }),
										variant: "danger",
										onConfirm: () => model.onClearProviderModels(name),
									});
								}}
								title={t("clearModels")}
								className="h-7 gap-1.5 px-2 text-[11.5px] text-muted-foreground hover:text-destructive"
							>
								<span className="icon-[mdi--delete-sweep-outline] h-3.5 w-3.5" />
								{t("clearModels")}
							</Button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
