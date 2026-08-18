import { SettingsPageShellView, SettingSection } from "@vetta/theme-ui/settings";
import { SettingsAiAssist } from "../ai-assist";
import { SETTINGS_SECTION } from "../registry";
import { WebhookEditorDialog } from "./WebhookEditorDialog";
import { WebhookEndpointList } from "./WebhookEndpointList";
import type { WebhookSettingsModel } from "./useWebhookSettingsModel";

export function WebhookSettingsView({ model }: { model: WebhookSettingsModel }): JSX.Element {
	return (
		<SettingsPageShellView
			title={model.labels.title}
			description={model.loading ? undefined : model.labels.description}
			headerAction={model.loading ? undefined : <SettingsAiAssist tabId="webhook" />}
			loading={model.loading}
			loadingLabel={model.labels.loading}
		>
			{!model.loading && (
				<>
					<SettingSection
						section={SETTINGS_SECTION["webhook-channels"]}
						title={
							<div className="flex items-center justify-between">
								<span>{model.labels.channels}</span>
								<button
									type="button"
									onClick={model.actions.openCreate}
									className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
								>
									<span className="icon-[mdi--plus] h-4 w-4" />
									{model.labels.add}
								</button>
							</div>
						}
					>
						<WebhookEndpointList model={model} />
					</SettingSection>
					<WebhookEditorDialog model={model} />
				</>
			)}
		</SettingsPageShellView>
	);
}
