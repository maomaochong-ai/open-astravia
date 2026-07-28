import type { JSX, ReactNode } from "react";
import { Switch } from "@vetta/ui";
import { SettingRow, SettingSection, type SettingSectionMeta } from "./SettingChrome";

export interface PetDecorationView {
	readonly id: string;
	readonly label: string;
	readonly found: boolean;
	readonly url: string;
}

export interface PetBubbleStyleOptionView {
	readonly id: string;
	readonly label: string;
	readonly description: string;
	readonly decorUrl?: string;
}

export interface PetSettingsViewLabels {
	readonly pageTitle: string;
	readonly materialMissing: string;
	readonly decorationAvailable: string;
	readonly decorationMissing: string;
	readonly showPet: string;
	readonly showPetDescription: string;
	readonly alwaysOnTop: string;
	readonly alwaysOnTopDescription: string;
	readonly decorationSectionDescription: string;
	readonly bubbleSectionDescription: string;
	readonly developerDescription: string;
	readonly debugFrame: string;
	readonly debugFrameDescription: string;
	readonly sections: {
		readonly display: string;
		readonly decoration: string;
		readonly bubble: string;
		readonly developer: string;
	};
}

export interface PetSettingsViewProps {
	readonly labels: PetSettingsViewLabels;
	readonly sections: {
		readonly display: SettingSectionMeta;
		readonly decoration: SettingSectionMeta;
		readonly bubble: SettingSectionMeta;
		readonly developer: SettingSectionMeta;
	};
	readonly enabled: boolean;
	readonly alwaysOnTop: boolean;
	readonly debugFrame: boolean;
	readonly decorations: readonly PetDecorationView[];
	/** 是否展示「桌宠装饰」分区；组件与数据链路保留，默认 true。 */
	readonly showDecorationSection?: boolean;
	readonly aiAssistSlot: ReactNode;
	readonly bubbleGrid: ReactNode;
	readonly onChangeEnabled: (value: boolean) => void;
	readonly onChangeAlwaysOnTop: (value: boolean) => void;
	readonly onChangeDebugFrame: (value: boolean) => void;
}

export function PetSettingsView({
	labels,
	sections,
	enabled,
	alwaysOnTop,
	debugFrame,
	decorations,
	showDecorationSection = true,
	aiAssistSlot,
	bubbleGrid,
	onChangeEnabled,
	onChangeAlwaysOnTop,
	onChangeDebugFrame,
}: PetSettingsViewProps): JSX.Element {
	return (
		<div className="mx-auto w-full max-w-[680px] px-8 pt-2 pb-4">
			<div className="mb-6 flex flex-wrap items-center justify-between gap-3">
				<h1 className="text-[20px] font-bold text-foreground">{labels.pageTitle}</h1>
				{aiAssistSlot}
			</div>

			<SettingSection title={labels.sections.display} section={sections.display}>
				<SettingRow title={labels.showPet} description={labels.showPetDescription}>
					<Switch checked={enabled} onCheckedChange={onChangeEnabled} />
				</SettingRow>
				<SettingRow title={labels.alwaysOnTop} description={labels.alwaysOnTopDescription} border={false}>
					<Switch
						checked={alwaysOnTop}
						onCheckedChange={onChangeAlwaysOnTop}
						disabled={!enabled}
					/>
				</SettingRow>
			</SettingSection>

			{showDecorationSection && (
				<SettingSection
					title={labels.sections.decoration}
					section={sections.decoration}
					description={labels.decorationSectionDescription}
				>
					<div className="grid grid-cols-2 gap-3 p-4">
						{decorations.map((decoration) => (
							<div
								key={decoration.id}
								className="overflow-hidden rounded-lg border border-border bg-card"
							>
								<div className="flex h-28 items-center justify-center bg-muted">
									{decoration.found ? (
										<img
											src={decoration.url}
											alt={decoration.label}
											className="max-h-full max-w-full object-contain"
											draggable={false}
										/>
									) : (
										<div className="px-3 text-center text-[12px] text-muted-foreground">
											{labels.materialMissing}
										</div>
									)}
								</div>
								<div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
									<div className="min-w-0 truncate text-[12px] font-medium text-foreground">
										{decoration.label}
									</div>
									<div className="shrink-0 text-[11px] text-muted-foreground">
										{decoration.found
											? labels.decorationAvailable
											: labels.decorationMissing}
									</div>
								</div>
							</div>
						))}
					</div>
				</SettingSection>
			)}

			<SettingSection
				title={labels.sections.bubble}
				section={sections.bubble}
				description={labels.bubbleSectionDescription}
			>
				{bubbleGrid}
			</SettingSection>

			<SettingSection
				title={labels.sections.developer}
				section={sections.developer}
				description={labels.developerDescription}
			>
				<SettingRow
					title={labels.debugFrame}
					description={labels.debugFrameDescription}
					border={false}
				>
					<Switch
						checked={debugFrame}
						onCheckedChange={onChangeDebugFrame}
						disabled={!enabled}
					/>
				</SettingRow>
			</SettingSection>
		</div>
	);
}
