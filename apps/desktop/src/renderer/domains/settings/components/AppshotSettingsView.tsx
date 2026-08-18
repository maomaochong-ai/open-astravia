import { MacKeyboardPreview } from "@shared/components/MacKeyboardPreview";
import { AppshotSettingsView as ThemeAppshotSettingsView } from "@vetta/theme-ui/settings";
import { Trans } from "react-i18next";
import { SETTINGS_SECTION } from "../registry";
import type { AppshotSelectValue, AppshotSettingsModel } from "./useAppshotSettingsModel";

/** Thin host adapter: i18n Trans + MacKeyboardPreview; Select is @vetta/ui inside theme-ui. */
export function AppshotSettingsView({ model }: { model: AppshotSettingsModel }): JSX.Element {
	return (
		<ThemeAppshotSettingsView
			labels={model.labels}
			subtitle={
				<Trans
					i18nKey="appshotPageSubtitle"
					ns="settings"
					components={{
						hl: <span className="rounded-[4px] bg-primary/10 px-1 font-medium text-primary" />,
					}}
				/>
			}
			gestureSection={SETTINGS_SECTION["appshot-gesture"]}
			permissionsSection={SETTINGS_SECTION["appshot-permissions"]}
			showKeyboardPreview={model.value !== "none"}
			keyboardPreview={<MacKeyboardPreview highlightKeys={model.highlightKeys} />}
			gestureValue={model.value}
			gestureOptions={model.options}
			onGestureChange={(value) => void model.actions.changeGesture(value as AppshotSelectValue)}
			accessibilityStatus={model.snapshot ? model.snapshot.accessibility : "unknown"}
			screenStatus={model.snapshot ? model.snapshot.screenRecording : "unknown"}
			onOpenOnboarding={model.actions.openOnboarding}
		/>
	);
}
