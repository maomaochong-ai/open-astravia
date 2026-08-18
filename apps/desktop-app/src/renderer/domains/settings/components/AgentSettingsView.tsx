import { Button } from "@vetta/ui";
import { Switch } from "@vetta/ui";
import { useMemo } from "react";
import { SettingsAiAssist } from "../ai-assist";
import { SETTINGS_SECTION } from "../registry";
import { MotionSelect, SettingHeading, SettingRow, SettingSection } from "@vetta/theme-ui/settings";
import type { AgentSettingsModel } from "./useAgentSettingsModel";

export interface AgentSettingsViewProps {
	model: AgentSettingsModel;
}

export function AgentSettingsView({ model }: AgentSettingsViewProps): JSX.Element {
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

			<div className="mb-6 p-1.5">
				<SettingHeading
					title={model.labels.sections.personalization}
					section={SETTINGS_SECTION["agent-personalization"]}
					className="mb-1"
				/>
				<p className="mb-4 text-[12px] text-muted-foreground">{model.labels.agentDescription}</p>

				<div>
					<div className="text-[13px] font-medium text-foreground">{model.labels.persona}</div>
					<div className="mt-2">
						<MotionSelect
							value={model.personaId}
							onValueChange={model.actions.setPersonaId}
							options={personaOptions}
							placeholder={model.labels.defaultPersona}
							triggerClassName="w-full max-w-[200px]"
							aria-label={model.labels.persona}
						/>
					</div>
					{model.selectedPersona?.description && (
						<p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
							{model.selectedPersona.description}
						</p>
					)}
				</div>

				<div className="mt-5">
					<div className="text-[13px] font-medium text-foreground">{model.labels.customInstructions}</div>
					<p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
						{model.labels.customInstructionsDescription}
					</p>
					<textarea
						value={model.customPrompt}
						onChange={(event) => model.actions.setCustomPrompt(event.target.value)}
						placeholder={model.labels.customInstructionsPlaceholder}
						className="mt-3 w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-[13px] leading-relaxed text-foreground outline-none transition-colors focus:border-primary/50"
						style={{ minHeight: "120px" }}
					/>
				</div>

				<div className="mt-4 flex justify-end">
					<Button
						variant="primary"
						size="sm"
						className="min-w-[76px]"
						disabled={!model.dirty || model.saving}
						onClick={() => void model.actions.applyPersonalization()}
					>
						{model.saving
							? model.labels.saving
							: model.justSaved && !model.dirty
								? model.labels.applied
								: model.labels.apply}
					</Button>
				</div>
			</div>

			<div>
				<SettingSection title={model.labels.sections.experimental} section={SETTINGS_SECTION["agent-experimental"]}>
					<SettingRow
						title={model.labels.appOp}
						description={model.labels.appOpDescription}
					>
						<Switch checked={model.vettaCliEnabled} onCheckedChange={model.actions.toggleVettaCli} />
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
		</div>
	);
}
