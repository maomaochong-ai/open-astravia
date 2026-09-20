import type { JSX } from "react";
import { cn, Switch } from "@vetta-org/ui";
import { MotionSelect } from "./MotionSelect";
import { SettingRow, SettingSection, type SettingSectionMeta } from "./SettingChrome";
import { InputField } from "./SettingsFormFields";

export interface ProxyProviderRowView {
	readonly id: string;
	readonly displayName: string;
	/** 该服务商是否经代理出网。 */
	readonly useProxy: boolean;
	/**
	 * 非空表示此服务商无法走应用代理（厂商 SDK 自己发请求），
	 * 文案直接展示给用户，开关置为只读。
	 */
	readonly unsupportedReason?: string;
}

export interface ProxySettingsSectionViewLabels {
	readonly sectionTitle: string;
	readonly enableTitle: string;
	readonly enableDescription: string;
	readonly protocolTitle: string;
	readonly hostTitle: string;
	readonly hostPlaceholder: string;
	readonly portTitle: string;
	readonly usernameTitle: string;
	readonly usernamePlaceholder: string;
	readonly passwordTitle: string;
	readonly passwordPlaceholder: string;
	readonly passwordStoredPlaceholder: string;
	readonly providersTitle: string;
	readonly providersDescription: string;
	readonly noProviders: string;
	readonly invalidConfig: string;
}

export interface ProxySettingsSectionViewProps {
	readonly section: SettingSectionMeta;
	readonly labels: ProxySettingsSectionViewLabels;
	readonly enabled: boolean;
	readonly onEnabledChange: (enabled: boolean) => void;
	readonly protocol: string;
	readonly protocolOptions: readonly { value: string; label: string }[];
	readonly onProtocolChange: (protocol: string) => void;
	readonly host: string;
	readonly onHostChange: (host: string) => void;
	readonly port: string;
	readonly onPortChange: (port: string) => void;
	readonly username: string;
	readonly onUsernameChange: (username: string) => void;
	readonly password: string;
	readonly passwordStored: boolean;
	readonly onPasswordChange: (password: string) => void;
	/** 配置不完整/非法时为 true：此时代理请求会失败，必须显式告知。 */
	readonly invalid: boolean;
	readonly providers: readonly ProxyProviderRowView[];
	readonly onProviderUseProxyChange: (providerId: string, useProxy: boolean) => void;
}

/**
 * 「网络代理」设置区块。
 *
 * 只有开启后才展开地址与逐服务商开关：关着的时候那些字段既无意义，又会让这一节
 * 在通用设置里喧宾夺主。
 */
export function ProxySettingsSectionView({
	section,
	labels,
	enabled,
	onEnabledChange,
	protocol,
	protocolOptions,
	onProtocolChange,
	host,
	onHostChange,
	port,
	onPortChange,
	username,
	onUsernameChange,
	password,
	passwordStored,
	onPasswordChange,
	invalid,
	providers,
	onProviderUseProxyChange,
}: ProxySettingsSectionViewProps): JSX.Element {
	return (
		<SettingSection section={section} title={labels.sectionTitle}>
			<SettingRow title={labels.enableTitle} description={labels.enableDescription} border={enabled}>
				<Switch checked={enabled} onCheckedChange={onEnabledChange} aria-label={labels.enableTitle} />
			</SettingRow>

			{enabled && (
				<>
					<SettingRow title={labels.protocolTitle}>
						<MotionSelect
							value={protocol}
							onValueChange={onProtocolChange}
							options={[...protocolOptions]}
							triggerClassName="min-w-[120px]"
						/>
					</SettingRow>

					<SettingRow title={labels.hostTitle}>
						<div className="w-56">
							<InputField
								value={host}
								onChange={onHostChange}
								placeholder={labels.hostPlaceholder}
								aria-label={labels.hostTitle}
							/>
						</div>
					</SettingRow>

					<SettingRow title={labels.portTitle}>
						<div className="w-28">
							<InputField value={port} onChange={onPortChange} aria-label={labels.portTitle} />
						</div>
					</SettingRow>

					<SettingRow title={labels.usernameTitle}>
						<div className="w-56">
							<InputField
								value={username}
								onChange={onUsernameChange}
								placeholder={labels.usernamePlaceholder}
								aria-label={labels.usernameTitle}
							/>
						</div>
					</SettingRow>

					<SettingRow title={labels.passwordTitle} border={!invalid && providers.length === 0}>
						<div className="w-56">
							<InputField
								value={password}
								onChange={onPasswordChange}
								type="password"
								placeholder={passwordStored ? labels.passwordStoredPlaceholder : labels.passwordPlaceholder}
								aria-label={labels.passwordTitle}
							/>
						</div>
					</SettingRow>

					{invalid && (
						<div className="px-5 py-3 text-[12px] text-destructive" role="alert">
							{labels.invalidConfig}
						</div>
					)}

					<div className="px-5 pt-4">
						<div className="text-[13px] font-medium text-foreground">{labels.providersTitle}</div>
						<div className="mt-0.5 text-[12px] text-muted-foreground">{labels.providersDescription}</div>
					</div>

					{providers.length === 0 ? (
						<div className="px-5 py-4 text-[12px] text-muted-foreground">{labels.noProviders}</div>
					) : (
						<div className="mt-2">
							{providers.map((provider, index) => (
								<SettingRow
									key={provider.id}
									title={provider.displayName}
									description={provider.unsupportedReason}
									border={index < providers.length - 1}
								>
									<div className={cn(provider.unsupportedReason && "opacity-40")}>
										<Switch
											checked={provider.unsupportedReason ? false : provider.useProxy}
											disabled={Boolean(provider.unsupportedReason)}
											onCheckedChange={(checked) => onProviderUseProxyChange(provider.id, checked)}
											aria-label={provider.displayName}
										/>
									</div>
								</SettingRow>
							))}
						</div>
					)}
				</>
			)}
		</SettingSection>
	);
}
