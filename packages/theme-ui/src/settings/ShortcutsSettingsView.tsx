import type { JSX, ReactNode } from "react";
import { Button } from "@vetta-org/ui";
import { SettingRow, SettingSection, type SettingSectionMeta } from "./SettingChrome";

export interface ShortcutActionRowView {
	readonly id: string;
	readonly label: string;
	readonly description: string;
	readonly recorder: ReactNode;
}

export interface ShortcutsSettingsViewProps {
	readonly title: string;
	readonly resetAllLabel: string;
	readonly shortcutHint: string;
	readonly globalSection: SettingSectionMeta;
	readonly globalSectionTitle?: string;
	readonly aiAssistSlot: ReactNode;
	readonly onResetAll: () => void;
	readonly shortcutActions: readonly ShortcutActionRowView[];
	readonly quickPanelSection: ReactNode;
}

export function ShortcutsSettingsView({
	title,
	resetAllLabel,
	shortcutHint,
	globalSection,
	globalSectionTitle,
	aiAssistSlot,
	onResetAll,
	shortcutActions,
	quickPanelSection,
}: ShortcutsSettingsViewProps): JSX.Element {
	return (
		<div className="mx-auto w-full max-w-[680px] px-8 pt-2 pb-4">
			<div className="mb-6 flex flex-wrap items-center justify-between gap-3">
				<h1 className="text-[20px] font-bold text-foreground">{title}</h1>
				<div className="flex flex-wrap items-center gap-2">
					{aiAssistSlot}
					<Button variant="secondary" size="sm" onClick={onResetAll}>
						<span className="icon-[mdi--restore] h-3.5 w-3.5" />
						{resetAllLabel}
					</Button>
				</div>
			</div>

			<SettingSection section={globalSection} title={globalSectionTitle}>
				{shortcutActions.map((action, idx) => (
					<SettingRow
						key={action.id}
						title={action.label}
						description={action.description}
						border={idx < shortcutActions.length - 1}
					>
						{action.recorder}
					</SettingRow>
				))}
			</SettingSection>

			{quickPanelSection}

			<p className="mt-4 text-[12px] leading-relaxed text-muted-foreground/50">{shortcutHint}</p>
		</div>
	);
}
