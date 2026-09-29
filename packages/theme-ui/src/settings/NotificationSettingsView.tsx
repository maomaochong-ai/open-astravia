import type { JSX } from "react";
import { Button, Switch } from "@vetta-org/ui";
import { MotionSelect } from "./MotionSelect";
import { SettingRow, SettingSection, type SettingSectionMeta } from "./SettingChrome";

export type NotificationScopeView = "background-only" | "away-from-session" | "always";

export interface NotificationSettingsViewLabels {
	systemNotifications: string;
	systemNotificationsDescription: string;
	soundNotifications: string;
	soundNotificationsDescription: string;
	soundTiming: string;
	preview: string;
	previewAction?: string;
	scopes: Record<NotificationScopeView, string>;
}

export interface NotificationSettingsViewProps {
	section: SettingSectionMeta;
	sectionTitle: string;
	labels: NotificationSettingsViewLabels;
	notificationsEnabled: boolean;
	soundEnabled: boolean;
	soundScope: NotificationScopeView;
	onNotificationsEnabledChange: (enabled: boolean) => void;
	onSoundEnabledChange: (enabled: boolean) => void;
	onSoundScopeChange: (scope: NotificationScopeView) => void;
	onPreview: () => void;
}

export function NotificationSettingsView({
	section,
	sectionTitle,
	labels,
	notificationsEnabled,
	soundEnabled,
	soundScope,
	onNotificationsEnabledChange,
	onSoundEnabledChange,
	onSoundScopeChange,
	onPreview,
}: NotificationSettingsViewProps): JSX.Element {
	const scopeOptions = (Object.keys(labels.scopes) as NotificationScopeView[]).map((scope) => ({
		value: scope,
		label: labels.scopes[scope],
	}));

	return (
		<SettingSection title={sectionTitle} section={section}>
			<SettingRow title={labels.systemNotifications} description={labels.systemNotificationsDescription}>
				<Switch checked={notificationsEnabled} onCheckedChange={onNotificationsEnabledChange} />
			</SettingRow>
			<SettingRow
				title={labels.soundNotifications}
				description={labels.soundNotificationsDescription}
				border={soundEnabled}
			>
				<Switch checked={soundEnabled} onCheckedChange={onSoundEnabledChange} />
			</SettingRow>
			{soundEnabled ? (
				<>
					<SettingRow title={labels.soundTiming}>
						<MotionSelect
							value={soundScope}
							onValueChange={(scope) => onSoundScopeChange(scope as NotificationScopeView)}
							options={scopeOptions}
							triggerClassName="min-w-[150px]"
						/>
					</SettingRow>
					<SettingRow title={labels.preview} border={false}>
						<Button size="sm" variant="outline" onClick={onPreview}>
							{labels.previewAction ?? labels.preview}
						</Button>
					</SettingRow>
				</>
			) : null}
		</SettingSection>
	);
}
