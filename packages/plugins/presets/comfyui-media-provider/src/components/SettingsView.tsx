import { useTranslation } from "@vetta-org/plugin-sdk";
import { type JSX, useEffect, useState } from "react";
import type { ProviderSettings, ProviderSettingsStore } from "../settings/provider-settings.js";

export type ProbeResult = { readonly ok: true; readonly detail?: string } | { readonly ok: false; readonly detail: string };

/**
 * 配置页需要的副作用出口。全部走 props 注入，组件本身不 import ctx——
 * 这样整页可以在 jsdom 里用窄 fake 测出来，不必挂真实宿主。
 */
export interface SettingsPorts {
	store: ProviderSettingsStore;
	/** 打一次 ComfyUI 的只读接口，确认地址可达。 */
	probe(baseUrl: string): Promise<ProbeResult>;
}

type ProbeState = { phase: "idle" } | { phase: "checking" } | ({ phase: "done" } & ProbeResult);

function ComfyIcon(): JSX.Element {
	return (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-6" aria-hidden>
			<rect x="2.5" y="5" width="19" height="14" rx="3" />
			<path d="m10 9.5 4.5 2.5L10 14.5z" strokeLinejoin="round" />
		</svg>
	);
}

/**
 * 一行配置。标题、说明在左，输入框在右下——纵向排布比左右分栏更耐窄侧栏，
 * 也让长 URL 有完整宽度可用。
 */
function Field({
	title,
	description,
	value,
	placeholder,
	onCommit,
}: {
	title: string;
	description: string;
	value: string;
	placeholder?: string;
	onCommit: (next: string) => void;
}): JSX.Element {
	const [draft, setDraft] = useState(value);
	// 外部（另一个视图、迁移写入）改了值时跟随，但不要打断正在输入的用户。
	useEffect(() => setDraft(value), [value]);
	return (
		<div className="comfy-field flex flex-col gap-2 px-4 py-3.5">
			<div className="flex flex-col gap-1">
				<span className="text-[13px] leading-none">{title}</span>
				<span className="text-xs leading-relaxed text-muted-foreground">{description}</span>
			</div>
			<input
				className="comfy-input"
				value={draft}
				placeholder={placeholder}
				spellCheck={false}
				autoComplete="off"
				onChange={(event) => setDraft(event.target.value)}
				onBlur={() => {
					if (draft !== value) onCommit(draft);
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter") event.currentTarget.blur();
				}}
			/>
		</div>
	);
}

function probeColor(state: ProbeState): string {
	if (state.phase === "checking") return "#f59e0b";
	if (state.phase === "done") return state.ok ? "#22c55e" : "var(--destructive, #ef4444)";
	return "var(--muted-foreground)";
}

/** 工作区配置页：服务地址、连通性自检与模板任务。 */
export function SettingsView({ ports }: { ports: SettingsPorts }): JSX.Element {
	const { t } = useTranslation();
	const [settings, setSettings] = useState<ProviderSettings>(() => ports.store.current());
	const [probe, setProbe] = useState<ProbeState>({ phase: "idle" });

	useEffect(() => ports.store.subscribe(setSettings), [ports.store]);
	useEffect(() => {
		void ports.store.load();
	}, [ports.store]);

	const runProbe = (): void => {
		setProbe({ phase: "checking" });
		void ports
			.probe(settings.baseUrl)
			.then((result) => setProbe({ phase: "done", ...result }))
			.catch((error: unknown) => setProbe({ phase: "done", ok: false, detail: String(error) }));
	};

	const probeText =
		probe.phase === "checking"
			? t("settings.connection.checking")
			: probe.phase === "done"
				? probe.ok
					? t("settings.connection.ok")
					: t("settings.connection.failed")
				: t("settings.connection.idle");

	return (
		<div className="comfy-page" data-testid="comfy-settings">
			<div className="comfy-page-inner">
				<header className="flex items-start gap-4">
					<span className="comfy-icon-plate">
						<ComfyIcon />
					</span>
					<div className="flex min-w-0 flex-col gap-1.5 pt-0.5">
						<h1 className="text-xl font-semibold tracking-tight">{t("settings.title")}</h1>
						<p className="text-sm leading-relaxed text-muted-foreground">{t("settings.tagline")}</p>
					</div>
				</header>

				<section className="flex flex-col gap-2.5">
					<span className="comfy-section-label">{t("settings.connection.heading")}</span>
					<div className="comfy-card flex flex-col">
						<Field
							title={t("settings.baseUrl.title")}
							description={t("settings.baseUrl.description")}
							value={settings.baseUrl}
							placeholder="http://127.0.0.1:8188"
							onCommit={(next) => void ports.store.update({ baseUrl: next })}
						/>
						<div className="comfy-field flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
							<span
								className={`comfy-dot${probe.phase === "checking" ? " comfy-pulse" : ""}`}
								style={{ background: probeColor(probe) }}
								aria-hidden="true"
							/>
							<span className="text-[13px]">{probeText}</span>
							<button
								type="button"
								className="comfy-button-ghost ms-auto"
								disabled={probe.phase === "checking"}
								onClick={runProbe}
							>
								{t("settings.connection.test")}
							</button>
						</div>
						{probe.phase === "done" && probe.detail ? (
							<p
								className="px-4 pb-3 text-xs leading-relaxed"
								style={{ color: probe.ok ? "var(--muted-foreground)" : "var(--destructive, #ef4444)" }}
							>
								{probe.detail}
							</p>
						) : null}
					</div>
				</section>

				<section className="flex flex-col gap-2.5">
					<span className="comfy-section-label">{t("settings.template.heading")}</span>
					<div className="comfy-card flex flex-col">
						<Field
							title={t("settings.templatePromptId.title")}
							description={t("settings.templatePromptId.description")}
							value={settings.templatePromptId}
							placeholder={t("settings.template.placeholder")}
							onCommit={(next) => void ports.store.update({ templatePromptId: next })}
						/>
						<Field
							title={t("settings.referenceTemplatePromptId.title")}
							description={t("settings.referenceTemplatePromptId.description")}
							value={settings.referenceTemplatePromptId}
							placeholder={t("settings.template.placeholder")}
							onCommit={(next) => void ports.store.update({ referenceTemplatePromptId: next })}
						/>
					</div>
					<p className="px-1 text-xs leading-relaxed text-muted-foreground">{t("settings.template.hint")}</p>
				</section>

				<footer className="border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
					{t("settings.footer")}
				</footer>
			</div>
		</div>
	);
}
