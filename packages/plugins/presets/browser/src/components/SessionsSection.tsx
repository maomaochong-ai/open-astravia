import { useTranslation } from "@vetta-org/plugin-sdk";
import type { JSX } from "react";
import type { BrowserSessionInfo, BrowserTabInfo } from "../runtime/parse";

export interface SessionTabs {
	session: BrowserSessionInfo;
	tabs: BrowserTabInfo[];
}

export interface SessionsSectionProps {
	sessions: SessionTabs[];
	loading: boolean;
	error?: string;
	onRefresh: () => void;
	onActivate: (sessionId: string, ref: string) => void;
}

/** 会话与 tab 总览：每个对话在共享的 Chrome 里钉住一个 tab，这里把它们摊开。 */
export function SessionsSection({
	sessions,
	loading,
	error,
	onRefresh,
	onActivate,
}: SessionsSectionProps): JSX.Element {
	const { t } = useTranslation();
	return (
		<section className="browser-card" aria-label={t("console.sessions.title")}>
			<header className="flex items-center justify-between gap-2">
				<h2 className="text-sm font-medium">{t("console.sessions.title")}</h2>
				<button type="button" className="browser-button-ghost" onClick={onRefresh} disabled={loading}>
					{t("console.sessions.refresh")}
				</button>
			</header>
			{error ? <p className="text-xs text-red-500">{error}</p> : null}
			{sessions.length === 0 && !loading ? (
				<p className="text-xs opacity-60">{t("console.sessions.empty")}</p>
			) : null}
			<ul className="flex flex-col gap-2">
				{sessions.map(({ session, tabs }) => (
					<li key={session.id} className="flex flex-col gap-1">
						<span className="text-xs font-mono opacity-70">{session.id}</span>
						<ul className="flex flex-col gap-1">
							{tabs.map((tab) => (
								<li key={tab.ref} className="browser-row">
									<span className="min-w-0 flex-1 truncate" title={tab.url}>
										{tab.title || tab.url || tab.ref}
									</span>
									<button
										type="button"
										className="browser-button-ghost"
										onClick={() => onActivate(session.id, tab.ref)}
									>
										{t("console.sessions.reveal")}
									</button>
								</li>
							))}
						</ul>
					</li>
				))}
			</ul>
		</section>
	);
}
