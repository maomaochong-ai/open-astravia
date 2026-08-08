import type { JSX, ReactNode } from "react";
import { Button, Switch } from "@vetta/ui";
import { MotionSelect } from "./MotionSelect";
import { SettingRow, SettingSection, type SettingSectionMeta } from "./SettingChrome";

export interface GeneralSettingsViewLabels {
	readonly title: string;
	readonly sections: {
		readonly basics: string;
		readonly app: string;
		readonly developer: string;
	};
	readonly workspaceTitle: string;
	readonly workspaceDescription: string;
	readonly sandboxTitle: string;
	readonly sandboxDescription: string;
	readonly systemNotifications: string;
	readonly systemNotificationsDescription: string;
	readonly debugMode: string;
	readonly debugModeDescription: string;
	readonly exportDiagnostics: string;
	readonly exportDiagnosticsDescription: string;
	readonly startAppGuide: string;
	readonly startAppGuideDescription: string;
	readonly startAppGuideAction: string;
	/** App updates row title, e.g. "当前版本". */
	readonly appVersion: string;
	readonly fullAccess: string;
	readonly useSandbox: string;
	readonly export: string;
	readonly exporting: string;
	readonly reset: string;
}

export interface GeneralSettingsViewProps {
	readonly labels: GeneralSettingsViewLabels;
	readonly sections: {
		readonly basics: SettingSectionMeta;
		readonly app: SettingSectionMeta;
		readonly developer: SettingSectionMeta;
	};
	readonly workspacePath: string;
	readonly onSelectWorkspace: () => void;
	readonly onResetWorkspace: () => void;
	/** 与 App 引导同构：description + 右侧 action；有更新时 detail 挂在行下。 */
	readonly updatesDescription: string;
	readonly updatesAction: ReactNode;
	readonly updatesDetail: ReactNode;
	readonly executionMode: string;
	readonly onExecutionModeChange: (mode: string) => void;
	readonly sandboxUnavailableReason: string | null;
	readonly notificationsEnabled: boolean;
	readonly onNotificationsChange: (checked: boolean) => void;
	readonly debugMode: boolean;
	readonly onDebugChange: (checked: boolean) => void;
	readonly exportingDiagnostics: boolean;
	readonly onExportDiagnostics: () => void;
	readonly onStartAppGuide: () => void;
}

/**
 * Settings general page layout. Host chrome uses `@vetta/ui` primitives (not desktop components/ui).
 * UpdateChecker stays host-injected (desktop-connected).
 *
 * Grouped into 3 sections to reduce one-setting-per-card scatter:
 * - basics: workspace, sandbox, notifications
 * - app: updates, setup guide
 * - developer: debug mode, diagnostics export
 */
export function GeneralSettingsView({
	labels,
	sections,
	workspacePath,
	onSelectWorkspace,
	onResetWorkspace,
	updatesDescription,
	updatesAction,
	updatesDetail,
	executionMode,
	onExecutionModeChange,
	sandboxUnavailableReason,
	notificationsEnabled,
	onNotificationsChange,
	debugMode,
	onDebugChange,
	exportingDiagnostics,
	onExportDiagnostics,
	onStartAppGuide,
}: GeneralSettingsViewProps): JSX.Element {
	return (
		<div className="mx-auto w-full max-w-[680px] px-8 pt-2 pb-4">
			<h1 className="mb-6 text-[20px] font-bold text-foreground">{labels.title}</h1>

			<SettingSection title={labels.sections.basics} section={sections.basics}>
				<SettingRow title={labels.workspaceTitle} description={labels.workspaceDescription}>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={onSelectWorkspace}
							className="flex items-center gap-2 rounded-lg border border-input bg-secondary px-3 py-1.5 text-[12px] text-foreground transition-colors hover:bg-accent"
						>
							<span className="icon-[mdi--folder-outline] h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span className="max-w-[180px] truncate">{workspacePath}</span>
							<span className="icon-[mdi--chevron-down] h-3.5 w-3.5 shrink-0 text-muted-foreground" />
						</button>
						<button
							type="button"
							onClick={onResetWorkspace}
							className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							title={labels.reset}
						>
							<span className="icon-[mdi--restore] h-3.5 w-3.5" />
						</button>
					</div>
				</SettingRow>
				<SettingRow title={labels.sandboxTitle} description={labels.sandboxDescription}>
					<MotionSelect
						value={executionMode}
						onValueChange={onExecutionModeChange}
						triggerClassName="min-w-[120px]"
						options={[
							{ value: "full-access", label: labels.fullAccess },
							{
								value: "sandbox",
								label: labels.useSandbox,
								disabled: Boolean(sandboxUnavailableReason),
								title: sandboxUnavailableReason ?? undefined,
							},
						]}
					/>
				</SettingRow>
				<SettingRow
					title={labels.systemNotifications}
					description={labels.systemNotificationsDescription}
					border={false}
				>
					<Switch checked={notificationsEnabled} onCheckedChange={onNotificationsChange} />
				</SettingRow>
			</SettingSection>

			<SettingSection title={labels.sections.app} section={sections.app}>
				{/* 与下方 App 引导同一 SettingRow：左标题+描述，右 outline sm 按钮。 */}
				<SettingRow
					title={labels.appVersion}
					description={updatesDescription || undefined}
					border={!updatesDetail}
				>
					{updatesAction}
				</SettingRow>
				{updatesDetail ? <div className="border-b border-border px-5 pb-4">{updatesDetail}</div> : null}
				<SettingRow title={labels.startAppGuide} description={labels.startAppGuideDescription} border={false}>
					<Button size="sm" variant="outline" onClick={onStartAppGuide}>
						{labels.startAppGuideAction}
					</Button>
				</SettingRow>
			</SettingSection>

			<SettingSection title={labels.sections.developer} section={sections.developer}>
				<SettingRow title={labels.debugMode} description={labels.debugModeDescription}>
					<Switch checked={debugMode} onCheckedChange={onDebugChange} />
				</SettingRow>
				<SettingRow
					title={labels.exportDiagnostics}
					description={labels.exportDiagnosticsDescription}
					border={false}
				>
					<Button size="sm" variant="outline" disabled={exportingDiagnostics} onClick={onExportDiagnostics}>
						{exportingDiagnostics ? labels.exporting : labels.export}
					</Button>
				</SettingRow>
			</SettingSection>
		</div>
	);
}
