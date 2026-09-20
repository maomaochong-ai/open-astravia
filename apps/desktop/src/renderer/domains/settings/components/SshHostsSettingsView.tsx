import { Button } from "@shared/components/ui/button";
import { SettingsPageShellView, SettingSection } from "@vetta-org/theme-ui/settings";
import { SETTINGS_SECTION } from "../registry";
import { SshHostForm } from "./SshHostForm";
import { SshHostList } from "./SshHostList";
import type { SshHostsSettingsModel } from "./useSshHostsSettingsModel";

export function SshHostsSettingsView({ model }: { model: SshHostsSettingsModel }): JSX.Element {
	const { labels, actions } = model;
	return (
		<SettingsPageShellView
			title={labels.title}
			description={model.loading ? undefined : labels.description}
			loading={model.loading}
			loadingLabel={labels.loading}
		>
			{!model.loading && (
				<SettingSection
					section={SETTINGS_SECTION["ssh-hosts-list"]}
					title={
						<div className="flex items-center justify-between gap-3">
							<span>{labels.section}</span>
							<div className="flex items-center gap-2">
								<Button
									variant="outline"
									size="sm"
									onClick={() => void actions.importFromConfig()}
									disabled={model.importing}
								>
									<span className="icon-[solar--import-linear] h-3.5 w-3.5" />
									{labels.importFromConfig}
								</Button>
								<Button
									variant="primary"
									size="sm"
									onClick={actions.startAdd}
									disabled={model.editingId === "new"}
								>
									<span className="icon-[solar--add-circle-linear] h-3.5 w-3.5" />
									{labels.add}
								</Button>
							</div>
						</div>
					}
				>
					{model.editingId === "new" && <SshHostForm model={model} heading={labels.addTitle} />}
					{model.hosts.length === 0 && model.editingId !== "new" ? (
						<div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
							<span className="icon-[solar--server-linear] h-8 w-8 text-muted-foreground" />
							<p className="text-[13px] text-foreground">{labels.empty}</p>
							<p className="max-w-[360px] text-[12px] text-muted-foreground">{labels.emptyHint}</p>
						</div>
					) : (
						<SshHostList model={model} />
					)}
				</SettingSection>
			)}
		</SettingsPageShellView>
	);
}
