import type { AppMonitorSettingsAction, AppMonitorSettingsTab } from "../../../../preload/api-types/app-monitor";

export function recordSettingsUsage(input: {
	action: AppMonitorSettingsAction;
	tab: AppMonitorSettingsTab;
	target: string;
	value?: string;
}): void {
	try {
		window.vetta.appMonitor.recordEvent({
			type: "settings.changed",
			tab: input.tab,
			action: input.action,
			target: input.target,
			...(input.value ? { value: input.value } : {}),
		});
	} catch {
		// Monitoring must not affect settings behavior.
	}
}
