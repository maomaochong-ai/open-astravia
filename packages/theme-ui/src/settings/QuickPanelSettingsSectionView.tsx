import type { JSX } from "react";
import { cn } from "@vetta-org/ui";
import { MotionSelect } from "./MotionSelect";
import { SettingRow, SettingSection, type SettingSectionMeta } from "./SettingChrome";

export interface QuickPanelOptionView {
	readonly value: string;
	readonly label: string;
}

export interface QuickPanelSettingsSectionViewProps {
	readonly section: SettingSectionMeta;
	readonly sectionTitle?: string;
	readonly triggerTitle: string;
	readonly triggerDescription: string;
	readonly trigger: string;
	readonly triggerOptions: readonly QuickPanelOptionView[];
	readonly onTriggerChange: (value: string) => void;
	readonly behaviorTitle: string;
	readonly behaviorDescription: string;
	readonly behavior: string;
	readonly behaviorOptions: readonly QuickPanelOptionView[];
	readonly onBehaviorChange: (value: string) => void;
	readonly behaviorDisabled: boolean;
}

export function QuickPanelSettingsSectionView({
	section,
	sectionTitle,
	triggerTitle,
	triggerDescription,
	trigger,
	triggerOptions,
	onTriggerChange,
	behaviorTitle,
	behaviorDescription,
	behavior,
	behaviorOptions,
	onBehaviorChange,
	behaviorDisabled,
}: QuickPanelSettingsSectionViewProps): JSX.Element {
	return (
		<SettingSection section={section} title={sectionTitle}>
			<SettingRow title={triggerTitle} description={triggerDescription}>
				<MotionSelect
					value={trigger}
					onValueChange={onTriggerChange}
					options={triggerOptions}
					triggerClassName="min-w-[150px]"
				/>
			</SettingRow>

			<SettingRow title={behaviorTitle} description={behaviorDescription} border={false}>
				<div className={cn("transition-opacity", behaviorDisabled && "pointer-events-none opacity-40")}>
					<MotionSelect
						value={behavior}
						onValueChange={onBehaviorChange}
						options={behaviorOptions}
						triggerClassName="min-w-[120px]"
						disabled={behaviorDisabled}
					/>
				</div>
			</SettingRow>
		</SettingSection>
	);
}
