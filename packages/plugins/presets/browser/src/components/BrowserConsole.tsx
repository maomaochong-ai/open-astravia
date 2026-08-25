import { useTranslation } from "@vetta-org/plugin-sdk";
import { type JSX, useCallback, useEffect, useState } from "react";
import type { BrowserActivityEntry, BrowserActivityLog } from "../activity/log";
import { type BrowserPluginSettings, parseAllowedDomains } from "../config/settings";
import type { SavedCredential } from "../runtime/parse";
import type { BrowserRuntimeController, RuntimeStatus } from "../runtime/runtime-controller";
import { CredentialsSection } from "./CredentialsSection";
import { PolicySection } from "./PolicySection";
import { RuntimeSection } from "./RuntimeSection";
import { SessionsSection, type SessionTabs } from "./SessionsSection";

/**
 * 面板需要的所有副作用出口。全部走 props 注入，组件本身不 import ctx——
 * 这样面板的四态流程可以在 jsdom 里用窄 fake 完整测出来，不必挂真实宿主。
 */
export interface BrowserConsolePorts {
	runtime: BrowserRuntimeController;
	activity: BrowserActivityLog;
	readSettings: () => BrowserPluginSettings;
	onSettingsChange: (listener: (settings: BrowserPluginSettings) => void) => () => void;
	loadSessions: () => Promise<{ sessions: SessionTabs[]; error?: string }>;
	loadCredentials: () => Promise<{ credentials: SavedCredential[]; error?: string }>;
	deleteCredential: (name: string) => Promise<void>;
	activateTab: (sessionId: string, ref: string) => Promise<void>;
	clearSignInState: (sessionId: string) => Promise<void>;
}

export function BrowserConsole({ ports }: { ports: BrowserConsolePorts }): JSX.Element {
	const { t } = useTranslation();
	const [status, setStatus] = useState<RuntimeStatus>(() => ports.runtime.current());
	const [settings, setSettings] = useState<BrowserPluginSettings>(() => ports.readSettings());
	const [entries, setEntries] = useState<readonly BrowserActivityEntry[]>(() => ports.activity.list());
	const [sessions, setSessions] = useState<SessionTabs[]>([]);
	const [sessionsError, setSessionsError] = useState<string | undefined>(undefined);
	const [sessionsLoading, setSessionsLoading] = useState(false);
	const [credentials, setCredentials] = useState<SavedCredential[]>([]);
	const [credentialsError, setCredentialsError] = useState<string | undefined>(undefined);

	useEffect(() => ports.runtime.subscribe(setStatus), [ports.runtime]);
	useEffect(() => ports.activity.subscribe(setEntries), [ports.activity]);
	useEffect(() => ports.onSettingsChange(setSettings), [ports]);

	const refreshSessions = useCallback(async () => {
		setSessionsLoading(true);
		try {
			const result = await ports.loadSessions();
			setSessions(result.sessions);
			setSessionsError(result.error);
		} finally {
			setSessionsLoading(false);
		}
	}, [ports]);

	const refreshCredentials = useCallback(async () => {
		const result = await ports.loadCredentials();
		setCredentials(result.credentials);
		setCredentialsError(result.error);
	}, [ports]);

	// 运行时就绪之前查询必然失败（二进制都还不在），没必要用一串红色错误迎接用户。
	useEffect(() => {
		if (status.phase !== "ready") return;
		void refreshSessions();
		void refreshCredentials();
	}, [status.phase, refreshSessions, refreshCredentials]);

	const firstSessionId = sessions[0]?.session.id;

	return (
		<div className="browser-console" data-testid="browser-console">
			<h1 className="text-base font-medium">{t("console.title")}</h1>
			<RuntimeSection
				status={status}
				onInstallRuntime={() => void ports.runtime.installRuntime()}
				onInstallBrowser={() => void ports.runtime.installBrowser()}
				onRecheck={() => void ports.runtime.refresh()}
			/>
			<SessionsSection
				sessions={sessions}
				loading={sessionsLoading}
				error={sessionsError}
				onRefresh={() => void refreshSessions()}
				onActivate={(sessionId, ref) => void ports.activateTab(sessionId, ref)}
			/>
			<CredentialsSection
				credentials={credentials}
				error={credentialsError}
				canClearSignInState={firstSessionId !== undefined}
				onDelete={(name) => void ports.deleteCredential(name).then(refreshCredentials)}
				onClearSignInState={() => {
					if (firstSessionId === undefined) return;
					void ports.clearSignInState(firstSessionId);
				}}
			/>
			<PolicySection
				settings={settings}
				allowedDomains={parseAllowedDomains(settings.allowedDomains)}
				entries={entries}
			/>
		</div>
	);
}
