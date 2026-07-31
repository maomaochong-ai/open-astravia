import { SegmentedControl } from "@vetta/theme-ui/shared";
import { Button } from "@vetta/ui";
import { motion } from "motion/react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { CapabilitiesTour } from "@shared/tour";
import { SettingsAiAssist } from "../../settings/ai-assist";
import { resolveCategoryLabel } from "../lib/ability-presentation";
import {
	ABILITY_CATEGORY_CONNECTORS,
	ABILITY_CATEGORY_UNCATEGORIZED,
	type AbilitiesModel,
	type AbilityScope,
} from "../types";
import { AbilitiesBanner } from "./AbilitiesBanner";
import { AbilityCard } from "./AbilityCard";
import { AbilityMcpDialogs } from "./AbilityMcpDialogs";
import { AddAbilityMenu } from "./AddAbilityMenu";

const easeOut = [0.22, 1, 0.36, 1] as const;

export function AbilitiesPageView({ model }: { model: AbilitiesModel }): JSX.Element {
	const { t, i18n } = useTranslation("abilities");
	const skillFileInputRef = useRef<HTMLInputElement>(null);
	const pluginFileInputRef = useRef<HTMLInputElement>(null);

	return (
		<div className="relative flex h-full w-full flex-1 flex-col overflow-hidden">
			<input
				ref={skillFileInputRef}
				type="file"
				accept=".zip,.tar.gz,.tgz,application/zip,application/gzip,application/x-gzip"
				className="hidden"
				onChange={(event) => {
					const file = event.target.files?.[0];
					event.target.value = "";
					if (file) model.importSkillArchive(file);
				}}
			/>
			<input
				ref={pluginFileInputRef}
				type="file"
				accept=".zip,application/zip"
				className="hidden"
				onChange={(event) => {
					const file = event.target.files?.[0];
					event.target.value = "";
					if (file) model.importPluginArchive(file);
				}}
			/>

			<div className="relative shrink-0 px-8 pb-4">
				<motion.div
					className="mx-auto flex w-full max-w-5xl items-end justify-between gap-4"
					initial={{ opacity: 0, y: -8 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.5, ease: easeOut }}
				>
					<div className="min-w-0">
						<h1 className="bg-gradient-to-br from-foreground via-foreground to-foreground/70 bg-clip-text text-[26px] font-bold leading-tight tracking-tight text-transparent">
							{t("page.title")}
						</h1>
						<p className="mt-1 text-[12px] text-muted-foreground/60">{t("page.subtitle")}</p>
					</div>
					<div className="flex min-h-8 shrink-0 items-center gap-2">
						<SettingsAiAssist tabId="mcp" />
					</div>
				</motion.div>
			</div>

			<div className="flex-1 overflow-y-auto px-8 pt-5 pb-8 [scrollbar-gutter:stable]">
				<div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
					<AbilitiesBanner icons={model.bannerIcons} />

					<div className="flex flex-wrap items-center justify-between gap-3">
						<div data-tour="capabilities-search-add" className="flex min-w-0 flex-wrap items-center gap-2">
							<div className="relative w-56 shrink-0">
								<span className="icon-[solar--magnifer-linear] absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40" />
								<input
									type="text"
									placeholder={t("search.placeholder")}
									value={model.searchQuery}
									onChange={(event) => model.setSearchQuery(event.target.value)}
									className="h-8 w-full rounded-lg bg-secondary pl-8 pr-3 text-[12px] text-foreground placeholder:text-muted-foreground/40 transition-colors hover:bg-accent focus:bg-accent focus:outline-none"
								/>
							</div>
							<AddAbilityMenu
								importing={model.importing}
								onImportSkill={() => {
									model.setScope("mine");
									skillFileInputRef.current?.click();
								}}
								onImportPlugin={() => {
									model.setScope("mine");
									pluginFileInputRef.current?.click();
								}}
								onAddMcp={() => {
									model.setScope("mine");
									model.startAddManualMcp();
								}}
							/>
						</div>
						<div className="flex items-center gap-2">
							<Button variant="ghost" size="sm" disabled={model.refreshing} onClick={model.refresh}>
								<span
									className={`icon-[solar--refresh-linear] h-3.5 w-3.5 ${model.refreshing ? "animate-spin" : ""}`}
								/>
								{t("actions.refresh")}
							</Button>
							<div data-tour="capabilities-scope">
								<SegmentedControl
									items={[
										{ key: "discover" as AbilityScope, label: t("scope.discover") },
										{ key: "mine" as AbilityScope, label: t("scope.mine") },
									]}
									value={model.scope}
									onChange={model.setScope}
								/>
							</div>
						</div>
					</div>

					{model.errors.length > 0 && (
						<div className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-[12px] text-muted-foreground/70">
							<span className="icon-[solar--info-circle-linear] mt-0.5 h-3.5 w-3.5 shrink-0" />
							<span>{t("error.partial", { error: model.errors.join(" / ") })}</span>
						</div>
					)}
					<div data-tour="capabilities-list">
						{model.loading ? (
							<div className="flex min-h-52 flex-col items-center justify-center gap-2 text-muted-foreground/60">
								<span className="icon-[solar--refresh-linear] h-8 w-8 animate-spin" />
								<span className="text-[12px]">{t("loading")}</span>
							</div>
						) : model.items.length === 0 ? (
							<div className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-xl border border-border/50 bg-card/30 text-center">
								<span className="icon-[solar--magic-stick-3-linear] h-10 w-10 text-muted-foreground/50" />
								<div>
									<p className="text-[13px] font-semibold text-foreground">
										{model.searchQuery
											? t("empty.noMatch")
											: model.scope === "discover"
												? t("empty.discover")
												: t("empty.mine")}
									</p>
									<p className="mt-1 text-[11px] text-muted-foreground/60">
										{model.searchQuery ? t("empty.noMatchHint") : t("empty.hint")}
									</p>
								</div>
							</div>
						) : (
							<div className="flex flex-col gap-6">
								{model.groups.map((group) => (
									<section key={group.category} className="flex flex-col gap-2">
										<div className="flex items-baseline gap-2">
											<h2 className="text-[13px] font-semibold text-foreground/90">
												{group.category === ABILITY_CATEGORY_UNCATEGORIZED
													? t("group.uncategorized")
													: group.category === ABILITY_CATEGORY_CONNECTORS
														? t("group.connectors")
														: resolveCategoryLabel(group.category, group.categoryI18n, i18n.language)}
											</h2>
											<span className="text-[11px] tabular-nums text-muted-foreground/50">
												{group.items.length}
											</span>
										</div>
										<div className="grid grid-cols-2 gap-x-3 gap-y-0.5 lg:grid-cols-3">
											{group.items.map((item) => (
												<AbilityCard key={item.id} item={item} model={model} />
											))}
										</div>
									</section>
								))}
								{model.hasMore && (
									<div className="flex justify-center pt-2">
										<Button variant="secondary" size="sm" onClick={model.loadMore}>
											{t("actions.loadMore", { remaining: model.totalItems - model.items.length })}
										</Button>
									</div>
								)}
							</div>
						)}
					</div>
				</div>
			</div>

			<AbilityMcpDialogs mcp={model.mcp} />
			<CapabilitiesTour />
		</div>
	);
}
