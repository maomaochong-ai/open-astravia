import type { PersonaOption } from "@preload/api.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SETTINGS_SECTION } from "../registry";
import { recordSettingsUsage } from "./recordSettingsUsage";

const PERSONA_I18N_KEYS = {
	default: {
		label: "personas.default.label",
		description: "personas.default.description",
	},
	pragmatic: {
		label: "personas.pragmatic.label",
		description: "personas.pragmatic.description",
	},
	interactive: {
		label: "personas.interactive.label",
		description: "personas.interactive.description",
	},
} as const;

type PersonaI18nKey = (typeof PERSONA_I18N_KEYS)[keyof typeof PERSONA_I18N_KEYS]["label" | "description"];

function localizePersona(persona: PersonaOption, t: (key: PersonaI18nKey) => string): PersonaOption {
	const keys = PERSONA_I18N_KEYS[persona.id as keyof typeof PERSONA_I18N_KEYS];
	if (!keys) return persona;
	return {
		...persona,
		label: t(keys.label),
		description: t(keys.description),
	};
}

export interface AgentSettingsModel {
	actions: {
		applyPersonalization: () => Promise<void>;
		setCustomPrompt: (value: string) => void;
		setPersonaId: (value: string) => void;
		toggleAgentSkills: (checked: boolean) => void;
		togglePromptPrediction: (checked: boolean) => void;
		toggleVettaCli: (checked: boolean) => void;
	};
	agentSkillsEnabled: boolean;
	customPrompt: string;
	dirty: boolean;
	justSaved: boolean;
	labels: AgentSettingsLabels;
	personaId: string;
	personas: readonly PersonaOption[];
	promptPredictionEnabled: boolean;
	saving: boolean;
	selectedPersona?: PersonaOption;
	vettaCliEnabled: boolean;
}

interface AgentSettingsLabels {
	agentDescription: string;
	agentSkill: string;
	agentSkillDescription: string;
	appOp: string;
	appOpDescription: string;
	applied: string;
	apply: string;
	customInstructions: string;
	customInstructionsDescription: string;
	customInstructionsPlaceholder: string;
	defaultPersona: string;
	inputPrediction: string;
	inputPredictionDescription: string;
	persona: string;
	saving: string;
	sections: {
		experimental: string;
		personalization: string;
	};
	title: string;
}

export function useAgentSettingsModel(): AgentSettingsModel {
	const { t } = useTranslation("settings");
	const [personas, setPersonas] = useState<PersonaOption[]>([]);
	const [personaId, setPersonaId] = useState("default");
	const [customPrompt, setCustomPrompt] = useState("");
	const [applied, setApplied] = useState({ personaId: "default", customPrompt: "" });
	const [saving, setSaving] = useState(false);
	const [justSaved, setJustSaved] = useState(false);
	const [vettaCliEnabled, setVettaCliEnabled] = useState(true);
	const [promptPredictionEnabled, setPromptPredictionEnabled] = useState(false);
	const [agentSkillsEnabled, setAgentSkillsEnabled] = useState(true);

	useEffect(() => {
		void window.vetta.session.getPersonas().then(setPersonas);
		void window.vetta.session.getPersonalization().then((config) => {
			setPersonaId(config.personaId);
			setCustomPrompt(config.customPrompt);
			setApplied(config);
		});
		void window.vetta.config.get().then((config) => {
			setVettaCliEnabled(config.experimental?.vettaCli === true);
			setPromptPredictionEnabled(config.experimental?.promptPrediction === true);
			setAgentSkillsEnabled(config.experimental?.agentSkills !== false);
		});
	}, []);

	const toggleVettaCli = useCallback((checked: boolean) => {
		setVettaCliEnabled(checked);
		void window.vetta.config.set({ experimental: { vettaCli: checked } });
		recordSettingsUsage({ tab: "agent", action: checked ? "enabled" : "disabled", target: "vetta-cli" });
	}, []);

	const togglePromptPrediction = useCallback((checked: boolean) => {
		setPromptPredictionEnabled(checked);
		void window.vetta.config.set({ experimental: { promptPrediction: checked } });
		recordSettingsUsage({ tab: "agent", action: checked ? "enabled" : "disabled", target: "prompt-prediction" });
	}, []);

	const toggleAgentSkills = useCallback((checked: boolean) => {
		setAgentSkillsEnabled(checked);
		void window.vetta.config.set({ experimental: { agentSkills: checked } });
		recordSettingsUsage({ tab: "agent", action: checked ? "enabled" : "disabled", target: "agent-skills" });
	}, []);

	const dirty = personaId !== applied.personaId || customPrompt !== applied.customPrompt;

	const localizedPersonas = useMemo(() => personas.map((persona) => localizePersona(persona, t)), [personas, t]);
	const selectedPersona = localizedPersonas.find((persona) => persona.id === personaId);

	const applyPersonalization = useCallback(async () => {
		setSaving(true);
		const startedAt = performance.now();
		try {
			const next = { personaId, customPrompt };
			await window.vetta.session.setPersonalization(next);
			setApplied(next);
			recordSettingsUsage({
				tab: "agent",
				action: "saved",
				target: customPrompt.trim() ? "personalization-custom" : "personalization",
			});
			const elapsed = performance.now() - startedAt;
			if (elapsed < 450) await new Promise((resolve) => setTimeout(resolve, 450 - elapsed));
			setJustSaved(true);
			setTimeout(() => setJustSaved(false), 1500);
		} finally {
			setSaving(false);
		}
	}, [customPrompt, personaId]);

	const labels = useMemo<AgentSettingsLabels>(
		() => ({
			agentDescription: t("agentDescription"),
			agentSkill: t("agentSettings.agentSkill"),
			agentSkillDescription: t("agentSettings.agentSkillDesc"),
			appOp: t("agentSettings.appOp"),
			appOpDescription: t("agentSettings.appOpDesc"),
			applied: t("agentSettings.applied"),
			apply: t("agentSettings.apply"),
			customInstructions: t("agentSettings.customInstructions"),
			customInstructionsDescription: t("agentSettings.customInstructionsDesc"),
			customInstructionsPlaceholder: t("agentSettings.customInstructionsPlaceholder"),
			defaultPersona: t("agentSettings.default"),
			inputPrediction: t("agentSettings.inputPrediction"),
			inputPredictionDescription: t("agentSettings.inputPredictionDesc"),
			persona: t("agentSettings.persona"),
			saving: t("agentSettings.saving"),
			sections: {
				experimental: t(SETTINGS_SECTION["agent-experimental"].titleKey),
				personalization: t(SETTINGS_SECTION["agent-personalization"].titleKey),
			},
			title: t("agentSettings.title"),
		}),
		[t],
	);

	return {
		actions: {
			applyPersonalization,
			setCustomPrompt,
			setPersonaId,
			toggleAgentSkills,
			togglePromptPrediction,
			toggleVettaCli,
		},
		agentSkillsEnabled,
		customPrompt,
		dirty,
		justSaved,
		labels,
		personaId,
		personas: localizedPersonas,
		promptPredictionEnabled,
		saving,
		selectedPersona,
		vettaCliEnabled,
	};
}
