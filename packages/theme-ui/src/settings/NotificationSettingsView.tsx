import type { JSX } from "react";
import { Button, Slider, Switch } from "@vetta-org/ui";
import { MotionSelect } from "./MotionSelect";
import { SettingRow, SettingSection, type SettingSectionMeta } from "./SettingChrome";

export type NotificationScopeView = "background-only" | "away-from-session" | "always";
export type NotificationEventView = "completed" | "failed" | "actionRequired";
export type NotificationSoundView = "soft-chime" | "single-bell" | "wood-tap" | "digital-pulse";

export interface NotificationSettingsValueView {
	systemScope: NotificationScopeView;
	soundScope: NotificationScopeView;
	soundVolume: number;
	events: Record<NotificationEventView, { systemEnabled: boolean; soundId: NotificationSoundView | null }>;
}

export interface NotificationSettingsViewLabels {
	systemNotifications: string;
	systemNotificationsDescription: string;
	systemTiming: string;
	soundTiming: string;
	soundVolume: string;
	events: string;
	eventCompleted: string;
	eventFailed: string;
	eventActionRequired: string;
	systemBanner: string;
	preview: string;
	noSound: string;
	scopes: Record<NotificationScopeView, string>;
	sounds: Record<NotificationSoundView, string>;
}

export interface NotificationSettingsViewProps {
	section: SettingSectionMeta;
	sectionTitle: string;
	labels: NotificationSettingsViewLabels;
	notificationsEnabled: boolean;
	value: NotificationSettingsValueView;
	onNotificationsEnabledChange: (enabled: boolean) => void;
	onSystemScopeChange: (scope: NotificationScopeView) => void;
	onSoundScopeChange: (scope: NotificationScopeView) => void;
	onSoundVolumeChange: (volume: number) => void;
	onEventSystemEnabledChange: (event: NotificationEventView, enabled: boolean) => void;
	onEventSoundChange: (event: NotificationEventView, sound: NotificationSoundView | null) => void;
	onPreview: (sound: NotificationSoundView) => void;
}

export function NotificationSettingsView({
	section,
	sectionTitle,
	labels,
	notificationsEnabled,
	value,
	onNotificationsEnabledChange,
	onSystemScopeChange,
	onSoundScopeChange,
	onSoundVolumeChange,
	onEventSystemEnabledChange,
	onEventSoundChange,
	onPreview,
}: NotificationSettingsViewProps): JSX.Element {
	const scopeOptions = (Object.keys(labels.scopes) as NotificationScopeView[]).map((scope) => ({
		value: scope,
		label: labels.scopes[scope],
	}));
	const soundOptions = [
		{ value: "none", label: labels.noSound },
		...(Object.keys(labels.sounds) as NotificationSoundView[]).map((sound) => ({
			value: sound,
			label: labels.sounds[sound],
		})),
	];
	const events: Array<{ event: NotificationEventView; label: string }> = [
		{ event: "completed", label: labels.eventCompleted },
		{ event: "failed", label: labels.eventFailed },
		{ event: "actionRequired", label: labels.eventActionRequired },
	];

	return (
		<SettingSection title={sectionTitle} section={section}>
			<SettingRow title={labels.systemNotifications} description={labels.systemNotificationsDescription}>
				<Switch checked={notificationsEnabled} onCheckedChange={onNotificationsEnabledChange} />
			</SettingRow>
			<SettingRow title={labels.systemTiming}>
				<MotionSelect
					value={value.systemScope}
					onValueChange={(scope) => onSystemScopeChange(scope as NotificationScopeView)}
					options={scopeOptions}
					triggerClassName="min-w-[150px]"
				/>
			</SettingRow>
			<SettingRow title={labels.soundTiming}>
				<MotionSelect
					value={value.soundScope}
					onValueChange={(scope) => onSoundScopeChange(scope as NotificationScopeView)}
					options={scopeOptions}
					triggerClassName="min-w-[150px]"
				/>
			</SettingRow>
			<SettingRow title={labels.soundVolume}>
				<div className="flex w-[220px] items-center gap-3">
					<Slider
						value={[value.soundVolume]}
						aria-label={labels.soundVolume}
						aria-valuetext={`${value.soundVolume}%`}
						onValueChange={([volume]) => volume !== undefined && onSoundVolumeChange(volume)}
					/>
					<span className="w-10 text-right text-[12px] tabular-nums text-muted-foreground">
						{value.soundVolume}%
					</span>
				</div>
			</SettingRow>
			<div className="border-b border-border px-5 py-2 text-[11px] font-medium text-muted-foreground">
				{labels.events}
			</div>
			{events.map(({ event, label }, index) => {
				const preference = value.events[event];
				return (
					<SettingRow key={event} title={label} border={index < events.length - 1}>
						<div className="flex items-center gap-2">
							<span className="text-[11px] text-muted-foreground">{labels.systemBanner}</span>
							<Switch
								checked={preference.systemEnabled}
								onCheckedChange={(enabled) => onEventSystemEnabledChange(event, enabled)}
							/>
							<MotionSelect
								value={preference.soundId ?? "none"}
								onValueChange={(sound) =>
									onEventSoundChange(event, sound === "none" ? null : (sound as NotificationSoundView))
								}
								options={soundOptions}
								triggerClassName="min-w-[120px]"
							/>
							<Button
								size="sm"
								variant="outline"
								disabled={!preference.soundId}
								onClick={() => preference.soundId && onPreview(preference.soundId)}
							>
								{labels.preview}
							</Button>
						</div>
					</SettingRow>
				);
			})}
		</SettingSection>
	);
}
