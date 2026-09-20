import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button, Switch } from "@vetta-org/ui";
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_SETTINGS, type GitSettings, loadSettings, saveSettings } from "../git/settings";

/** One labelled row with a description and a control on the right. */
function SettingRow({
	title,
	description,
	children,
}: {
	title: string;
	description: string;
	children: React.ReactNode;
}): JSX.Element {
	return (
		<div className="flex items-start justify-between gap-6 border-b border-border py-3 last:border-b-0">
			<div className="min-w-0">
				<div className="text-[13px] font-medium text-foreground">{title}</div>
				<div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{description}</div>
			</div>
			<div className="shrink-0 pt-0.5">{children}</div>
		</div>
	);
}

/**
 * The plugin's configuration page, registered as an off-sidebar workspace view
 * (Settings → Extensions). The host has no declarative settings schema since
 * plugin API 1.6.0 (ADR-0105), so the page is ours to draw.
 *
 * Settings are global to the plugin: project-specific commit rules belong in the
 * project's AGENTS.md / CLAUDE.md, which generation reads with higher priority.
 */
export function GitSettingsView(): JSX.Element {
	const { t } = useTranslation();
	const [settings, setSettings] = useState<GitSettings | null>(null);
	const [saved, setSaved] = useState(false);

	useEffect(() => {
		let alive = true;
		void loadSettings().then((value) => {
			if (alive) setSettings(value);
		});
		return () => {
			alive = false;
		};
	}, []);

	const update = useCallback((patch: Partial<GitSettings>) => {
		setSaved(false);
		setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
	}, []);

	const persist = useCallback(async () => {
		if (!settings) return;
		await saveSettings(settings);
		setSaved(true);
	}, [settings]);

	if (!settings) {
		return <div className="px-6 py-4 text-[12px] text-muted-foreground">{t("state.loading")}</div>;
	}

	return (
		<div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-5">
			<div>
				<h1 className="text-[15px] font-semibold text-foreground">{t("settings.title")}</h1>
				<p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{t("settings.tagline")}</p>
			</div>

			<div className="flex flex-col">
				<div className="border-b border-border py-3">
					<div className="text-[13px] font-medium text-foreground">{t("settings.templateTitle")}</div>
					<div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{t("settings.templateHint")}</div>
					<textarea
						value={settings.messageTemplate}
						onChange={(event) => update({ messageTemplate: event.target.value })}
						rows={6}
						placeholder={t("settings.templatePlaceholder")}
						className="mt-2 w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 text-[12px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-ring"
					/>
				</div>

				<SettingRow title={t("settings.pushAfterCommitTitle")} description={t("settings.pushAfterCommitHint")}>
					<Switch checked={settings.pushAfterCommit} onCheckedChange={(next) => update({ pushAfterCommit: next })} />
				</SettingRow>

				<SettingRow title={t("settings.confirmDiscardTitle")} description={t("settings.confirmDiscardHint")}>
					<Switch checked={settings.confirmDiscard} onCheckedChange={(next) => update({ confirmDiscard: next })} />
				</SettingRow>
			</div>

			<div className="flex items-center gap-2">
				<Button type="button" size="sm" onClick={() => void persist()}>
					{t("settings.save")}
				</Button>
				<Button type="button" size="sm" variant="ghost" onClick={() => update(DEFAULT_SETTINGS)}>
					{t("settings.reset")}
				</Button>
				{saved && <span className="text-[12px] text-emerald-500">{t("settings.saved")}</span>}
			</div>
		</div>
	);
}
