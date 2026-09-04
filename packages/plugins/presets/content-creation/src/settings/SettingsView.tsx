import { useTranslation } from "@vetta-org/plugin-sdk";
import { type JSX, useEffect, useState } from "react";
import {
	CONTENT_SECRET_KEYS,
	type ContentPlainKey,
	type ContentSecretKey,
	type ContentSettingsStore,
} from "./content-settings";

/** 一组「服务商」：一个卡片里放它自己的密钥与模型字段，而不是把 8 个字段平铺成一张长表。 */
interface ProviderGroup {
	readonly id: string;
	readonly secrets: readonly ContentSecretKey[];
	readonly plains: readonly ContentPlainKey[];
}

const PROVIDER_GROUPS: readonly ProviderGroup[] = [
	{ id: "openai", secrets: ["openaiApiKey"], plains: ["openaiModel"] },
	{ id: "replicate", secrets: ["replicateApiToken"], plains: [] },
	{ id: "google", secrets: ["googleApiKey"], plains: [] },
	{ id: "custom", secrets: ["customApiKey"], plains: ["customBaseUrl", "customModel", "customVideoModel"] },
];

function useSettingsRevision(store: ContentSettingsStore): number {
	const [revision, setRevision] = useState(0);
	useEffect(() => store.subscribe(() => setRevision((value) => value + 1)), [store]);
	return revision;
}

function PlainField({
	label,
	description,
	value,
	onCommit,
}: {
	label: string;
	description?: string;
	value: string;
	onCommit: (next: string) => void;
}): JSX.Element {
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);
	return (
		<div className="content-settings-field">
			<div className="flex flex-col gap-1">
				<span className="text-[13px] leading-none">{label}</span>
				{description ? <span className="text-xs leading-relaxed text-muted-foreground">{description}</span> : null}
			</div>
			<input
				className="content-settings-input"
				value={draft}
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

/**
 * 密钥字段永远不回显已保存的值——存在与否用一个状态点表达，输入框只用于写入新值。
 * 这样即便有人截屏配置页，也不会把 API Key 一起带走。
 */
function SecretField({
	label,
	description,
	saved,
	savedText,
	emptyText,
	clearText,
	saveText,
	onSave,
}: {
	label: string;
	description?: string;
	saved: boolean;
	savedText: string;
	emptyText: string;
	clearText: string;
	saveText: string;
	onSave: (value: string) => void;
}): JSX.Element {
	const [draft, setDraft] = useState("");
	return (
		<div className="content-settings-field">
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
				<span className="text-[13px] leading-none">{label}</span>
				<span
					className="content-settings-dot"
					style={{ background: saved ? "#22c55e" : "var(--muted-foreground)" }}
					aria-hidden="true"
				/>
				<span className="text-xs text-muted-foreground">{saved ? savedText : emptyText}</span>
				{saved ? (
					<button type="button" className="content-settings-link ms-auto" onClick={() => onSave("")}>
						{clearText}
					</button>
				) : null}
			</div>
			{description ? <span className="text-xs leading-relaxed text-muted-foreground">{description}</span> : null}
			<div className="flex items-center gap-2">
				<input
					className="content-settings-input"
					type="password"
					value={draft}
					autoComplete="off"
					spellCheck={false}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={(event) => {
						if (event.key !== "Enter" || !draft.trim()) return;
						onSave(draft);
						setDraft("");
					}}
				/>
				<button
					type="button"
					className="content-settings-button"
					disabled={!draft.trim()}
					onClick={() => {
						onSave(draft);
						setDraft("");
					}}
				>
					{saveText}
				</button>
			</div>
		</div>
	);
}

/** 工作区配置页：按服务商分组的密钥与模型设置。 */
export function ContentSettingsView({ store }: { store: ContentSettingsStore }): JSX.Element {
	const { t } = useTranslation();
	useSettingsRevision(store);
	useEffect(() => {
		void store.load();
	}, [store]);
	const plain = store.plainValues();

	return (
		<div className="content-settings-page" data-testid="content-settings">
			<div className="content-settings-inner">
				<header className="flex flex-col gap-1.5">
					<h1 className="text-xl font-semibold tracking-tight">{t("settings.page.title")}</h1>
					<p className="text-sm leading-relaxed text-muted-foreground">{t("settings.page.tagline")}</p>
				</header>

				{PROVIDER_GROUPS.map((group) => (
					<section key={group.id} className="flex flex-col gap-2.5">
						<span className="content-settings-label">{t(`settings.group.${group.id}.title`)}</span>
						<div className="content-settings-card">
							{group.secrets.map((key) => (
								<SecretField
									key={key}
									label={t(`settings.${key}.title`)}
									description={t(`settings.${key}.description`)}
									saved={store.hasSecret(key)}
									savedText={t("settings.secret.saved")}
									emptyText={t("settings.secret.empty")}
									clearText={t("settings.secret.clear")}
									saveText={t("settings.secret.save")}
									onSave={(value) => void store.setSecret(key, value)}
								/>
							))}
							{group.plains.map((key) => (
								<PlainField
									key={key}
									label={t(`settings.${key}.title`)}
									description={t(`settings.${key}.description`)}
									value={plain[key]}
									onCommit={(next) => void store.updatePlain({ [key]: next })}
								/>
							))}
						</div>
					</section>
				))}

				<footer className="border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
					{t("settings.page.footer", { count: CONTENT_SECRET_KEYS.length })}
				</footer>
			</div>
		</div>
	);
}
