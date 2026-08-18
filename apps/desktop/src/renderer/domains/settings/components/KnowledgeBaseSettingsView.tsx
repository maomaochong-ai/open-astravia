import { KnowledgeHowItWorksDialog } from "@shared/components/KnowledgeHowItWorksDialog";
import { ModelSelect } from "@shared/components/ModelSelect";
import { Switch } from "@vetta/ui";
import { cn } from "@shared/lib/utils";
import { useMemo, useState } from "react";
import { SettingsAiAssist } from "../ai-assist";
import { SETTINGS_SECTION } from "../registry";
import { MotionSelect, SettingRow, SettingSection } from "@vetta/theme-ui/settings";
import type { KnowledgeBaseSettingsModel } from "./useKnowledgeBaseSettingsModel";

export function KnowledgeBaseSettingsView({ model }: { model: KnowledgeBaseSettingsModel }): JSX.Element {
	const [howItWorksOpen, setHowItWorksOpen] = useState(false);
	const btnClass =
		"inline-flex items-center gap-1.5 rounded-md border border-input bg-secondary px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-accent disabled:opacity-50";

	const intervalOptions = useMemo(
		() => [
			...model.intervalOptions.map((minutes) => ({
				value: String(minutes),
				label: model.labels.everyNMinutes(minutes),
			})),
			{ value: String(model.neverInterval), label: model.labels.never },
		],
		[model.intervalOptions, model.labels, model.neverInterval],
	);
	const concurrencyOptions = useMemo(
		() =>
			model.agentConcurrencyOptions.map((count) => ({
				value: String(count),
				label: model.labels.parallelN(count),
			})),
		[model.agentConcurrencyOptions, model.labels],
	);

	return (
		<div className="mx-auto w-full max-w-[680px] px-8 pt-2 pb-4">
			<div className="mb-6 flex flex-wrap items-center justify-between gap-3">
				<h1 className="text-[20px] font-bold text-foreground">{model.labels.title}</h1>
				<div className="flex flex-wrap items-center gap-2">
					<SettingsAiAssist tabId="knowledge" />
					<button
						type="button"
						onClick={() => setHowItWorksOpen(true)}
						className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						<span className="icon-[mdi--lightbulb-on-outline] h-4 w-4" />
						<span>{model.labels.howItWorks}</span>
					</button>
				</div>
			</div>

			<SettingSection
				title={model.labels.sections.processing}
				section={SETTINGS_SECTION["knowledge-processing"]}
				description={model.labels.howItWorksDescription}
			>
				<SettingRow title={model.labels.enable} description={model.labels.enableDescription}>
					<Switch checked={model.enabled} onCheckedChange={model.actions.toggle} />
				</SettingRow>
				<SettingRow title={model.labels.interval} description={model.labels.intervalDescription}>
					<MotionSelect
						value={String(model.interval)}
						onValueChange={model.actions.changeInterval}
						options={intervalOptions}
						disabled={!model.enabled}
						triggerClassName="min-w-[120px]"
					/>
				</SettingRow>
				<SettingRow title={model.labels.parallel} description={model.labels.parallelDescription}>
					<MotionSelect
						value={String(model.agentConcurrency)}
						onValueChange={model.actions.changeAgentConcurrency}
						options={concurrencyOptions}
						disabled={!model.enabled}
						triggerClassName="min-w-[120px]"
					/>
				</SettingRow>
				<SettingRow title={model.labels.model} description={model.labels.modelDescription} border={false}>
					{/* 不用 flex-wrap + basis-full：会把右侧撑满整行，左侧标题被压成单字竖列 */}
					<div className="flex flex-col items-end gap-1.5">
						<div className="flex items-center gap-2">
							<ModelSelect
								value={model.modelKey || null}
								onChange={(key) => model.actions.changeModel(key ?? "")}
								disabled={!model.enabled}
								placeholder={model.labels.selectModel}
								triggerClassName={cn(
									"h-8 w-[220px] max-w-full rounded-lg border-border bg-card px-2.5 text-[12px] font-medium hover:bg-accent data-[state=open]:bg-accent",
									model.enabled && !model.modelKey && "border-amber-500/50",
								)}
								reasoning={{ value: model.reasoningLevel || undefined, onChange: model.actions.changeReasoning }}
							/>
							<button
								type="button"
								onClick={() => void model.actions.probe()}
								disabled={!model.enabled || model.probing || !model.modelKey}
								className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-input bg-secondary px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-accent disabled:opacity-50"
							>
								<span>{model.labels.testConnect}</span>
								{model.probing ? (
									<span className="icon-[mdi--loading] h-3.5 w-3.5 animate-spin" />
								) : model.probeResult?.ok ? (
									<span className="icon-[mdi--check] h-3.5 w-3.5 text-green-600 dark:text-green-400" />
								) : model.probeResult && !model.probeResult.ok ? (
									<span className="icon-[mdi--close] h-3.5 w-3.5 text-red-500" />
								) : null}
							</button>
						</div>
						{model.enabled && !model.modelKey && (
							<span className="flex max-w-full items-center gap-1 text-[11px] text-amber-500">
								<span className="icon-[mdi--alert-circle-outline] h-3.5 w-3.5 shrink-0" />
								<span className="truncate">{model.labels.noModelSelected}</span>
							</span>
						)}
					</div>
				</SettingRow>
			</SettingSection>

			<SettingSection
				title={model.labels.sections.actions}
				section={SETTINGS_SECTION["knowledge-actions"]}
				description={model.status ?? undefined}
			>
				<SettingRow title={model.labels.processNow} description={model.labels.processNowDescription}>
					<button
						type="button"
						onClick={() => void model.actions.scan()}
						disabled={!model.enabled || !model.modelKey || model.busy !== null}
						className={btnClass}
					>
						<span>{model.labels.processNowButton}</span>
						{model.busy === "scan" && <span className="icon-[mdi--loading] h-3.5 w-3.5 animate-spin" />}
					</button>
				</SettingRow>
				<SettingRow title={model.labels.retryFailed} description={model.labels.retryFailedDescription}>
					<button
						type="button"
						onClick={() => void model.actions.retryFailed()}
						disabled={!model.enabled || !model.modelKey || model.busy !== null}
						className={btnClass}
					>
						<span>{model.labels.retryFailedButton}</span>
						{model.busy === "retry" && <span className="icon-[mdi--loading] h-3.5 w-3.5 animate-spin" />}
					</button>
				</SettingRow>
				<SettingRow title={model.labels.records} description={model.labels.recordsDescription}>
					<button type="button" onClick={() => void model.actions.openRecords()} className={btnClass}>
						<span>{model.labels.viewRecords}</span>
					</button>
				</SettingRow>
				<SettingRow title={model.labels.clearWiki} description={model.labels.clearWikiDescription} border={false}>
					<button
						type="button"
						onClick={model.actions.clearWiki}
						disabled={model.busy !== null}
						className="inline-flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[12px] text-red-500 transition-colors hover:bg-red-500/20 disabled:opacity-50"
					>
						<span className="icon-[mdi--trash-can-outline] h-3.5 w-3.5" />
						<span>{model.labels.clearWikiButton}</span>
						{model.busy === "clear" && <span className="icon-[mdi--loading] h-3.5 w-3.5 animate-spin" />}
					</button>
				</SettingRow>
			</SettingSection>

			<KnowledgeHowItWorksDialog open={howItWorksOpen} onClose={() => setHowItWorksOpen(false)} />
		</div>
	);
}
