import {
	Button,
	Switch,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
	cn,
} from "@astravia-org/ui";
import { useMemo, useState } from "react";
import { SettingsAiAssist } from "../ai-assist";
import { SETTINGS_SECTION } from "../registry";
import { MotionSelect, SettingRow, SettingSection } from "@astravia-org/theme-ui/settings";
import type { AgentSettingsModel } from "./useAgentSettingsModel";
import { RuntimeConfigurationSections } from "./RuntimeConfigurationSections";
import type { RuntimeConfigurationModel } from "./useRuntimeConfigurationModel";
import { ImageGenerationSettingsSection } from "./ImageGenerationSettingsSection";
import type { ImageGenerationSettingsModel } from "./useImageGenerationSettingsModel";

export interface AgentSettingsViewProps {
	model: AgentSettingsModel;
	imageGeneration: ImageGenerationSettingsModel;
	runtimeConfiguration: RuntimeConfigurationModel;
}

/**
 * 自定义指令：设置项右侧只放一个入口按钮，点开 Dialog 编辑，点「应用」才写入；
 * 关闭未应用则放弃草稿，回到已保存的内容。
 *
 * 指令可以很长，摊在设置页里会把同一页的其他人设选项挤下去，也不便与别的设置项并排比较。
 */
function CustomInstructionsDialog({ model }: { model: AgentSettingsModel }): JSX.Element {
	const [open, setOpen] = useState(false);
	const close = (next: boolean) => {
		if (!next) model.actions.discardCustomPromptDraft();
		setOpen(next);
	};
	return (
		<Dialog open={open} onOpenChange={close}>
			<DialogTrigger asChild>
				<Button variant="field">
					<span className="icon-[mdi--pencil-outline] h-3.5 w-3.5 text-muted-foreground" />
					{model.labels.customInstructionsEdit}
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-[520px]">
				<DialogHeader>
					<DialogTitle>{model.labels.customInstructions}</DialogTitle>
					<DialogDescription>{model.labels.customInstructionsDescription}</DialogDescription>
				</DialogHeader>
				<textarea
					value={model.customPrompt}
					onChange={(event) => model.actions.setCustomPrompt(event.target.value)}
					placeholder={model.labels.customInstructionsPlaceholder}
					className={cn(
						"w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-[13px] leading-relaxed text-foreground outline-none transition-colors focus:border-primary/50",
					)}
					style={{ minHeight: "200px" }}
				/>
				<DialogFooter>
					<Button variant="ghost" size="sm" onClick={() => close(false)}>
						{model.labels.cancel}
					</Button>
					<Button
						variant="primary"
						size="sm"
						className="min-w-[76px]"
						disabled={!model.dirty || model.saving}
						onClick={() => void model.actions.applyPersonalization().then(() => setOpen(false))}
					>
						{model.saving ? model.labels.saving : model.labels.apply}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export function AgentSettingsView({ model, imageGeneration, runtimeConfiguration }: AgentSettingsViewProps): JSX.Element {
	const personaOptions = useMemo(
		() => model.personas.map((persona) => ({ value: persona.id, label: persona.label })),
		[model.personas],
	);

	return (
		<div className="mx-auto w-full max-w-[680px] px-8 pt-2 pb-4">
			<div className="mb-6 flex flex-wrap items-center justify-between gap-3">
				<h1 className="text-[20px] font-bold text-foreground">{model.labels.title}</h1>
				<SettingsAiAssist tabId="agent" />
			</div>

			<SettingSection
				title={model.labels.sections.personalization}
				section={SETTINGS_SECTION["agent-personalization"]}
				description={model.labels.agentDescription}
			>
				<SettingRow title={model.labels.persona} description={model.selectedPersona?.description}>
					<MotionSelect
						value={model.personaId}
						onValueChange={(value) => void model.actions.selectPersona(value)}
						options={personaOptions}
						placeholder={model.labels.defaultPersona}
						aria-label={model.labels.persona}
					/>
				</SettingRow>
				<SettingRow
					title={model.labels.customInstructions}
					description={model.labels.customInstructionsDescription}
					border={false}
				>
					<CustomInstructionsDialog model={model} />
				</SettingRow>
			</SettingSection>

			<ImageGenerationSettingsSection model={imageGeneration} />

			<div>
				<SettingSection title={model.labels.sections.experimental} section={SETTINGS_SECTION["agent-experimental"]}>
					<SettingRow
						title={model.labels.appOp}
						description={model.labels.appOpDescription}
					>
						<Switch checked={model.astraviaCliEnabled} onCheckedChange={model.actions.toggleAstraviaCli} />
					</SettingRow>
					<SettingRow
						title={model.labels.inputPrediction}
						description={model.labels.inputPredictionDescription}
					>
						<Switch
							checked={model.promptPredictionEnabled}
							onCheckedChange={model.actions.togglePromptPrediction}
						/>
					</SettingRow>
					<SettingRow
						title={model.labels.agentSkill}
						description={model.labels.agentSkillDescription}
						border={false}
					>
						<Switch checked={model.agentSkillsEnabled} onCheckedChange={model.actions.toggleAgentSkills} />
					</SettingRow>
				</SettingSection>
			</div>

			<RuntimeConfigurationSections model={runtimeConfiguration} />
		</div>
	);
}
