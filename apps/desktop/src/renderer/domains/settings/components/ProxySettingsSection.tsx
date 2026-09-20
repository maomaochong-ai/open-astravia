import { ProxySettingsSectionView } from "@vetta-org/theme-ui/settings";
import { SETTINGS_SECTION } from "../registry";
import type { ProxySettingsModel } from "./useProxySettingsModel";

export function ProxySettingsSection({ model }: { model: ProxySettingsModel }): JSX.Element {
	return (
		<ProxySettingsSectionView
			section={SETTINGS_SECTION["general-network"]}
			labels={model.labels}
			enabled={model.draft.enabled}
			onEnabledChange={model.actions.setEnabled}
			protocol={model.draft.protocol}
			protocolOptions={model.protocolOptions}
			onProtocolChange={model.actions.setProtocol}
			host={model.draft.host}
			onHostChange={model.actions.setHost}
			port={model.draft.port}
			onPortChange={model.actions.setPort}
			username={model.draft.username}
			onUsernameChange={model.actions.setUsername}
			password={model.draft.password}
			passwordStored={model.passwordStored}
			onPasswordChange={model.actions.setPassword}
			invalid={model.invalid}
			providers={model.providers}
			onProviderUseProxyChange={model.actions.setProviderUseProxy}
		/>
	);
}
