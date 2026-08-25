import { useTranslation } from "@vetta-org/plugin-sdk";
import type { JSX } from "react";
import type { SavedCredential } from "../runtime/parse";

export interface CredentialsSectionProps {
	credentials: SavedCredential[];
	error?: string;
	/** 没有正在运行的会话时无从清理，按钮置灰而不是让用户点了没反应。 */
	canClearSignInState: boolean;
	onDelete: (name: string) => void;
	onClearSignInState: () => void;
}

/**
 * 登录态与凭据。
 *
 * 这里只展示名称与 URL —— agent-browser 的 `auth list` 本身也只返回这些，密码永远留在
 * 本机加密库里，不进 CLI 输出，更不进模型上下文。
 */
export function CredentialsSection({
	credentials,
	error,
	canClearSignInState,
	onDelete,
	onClearSignInState,
}: CredentialsSectionProps): JSX.Element {
	const { t } = useTranslation();
	return (
		<section className="browser-card" aria-label={t("console.credentials.title")}>
			<h2 className="text-sm font-medium">{t("console.credentials.title")}</h2>
			<p className="text-xs opacity-60">{t("console.credentials.hint")}</p>
			{error ? <p className="text-xs text-red-500">{error}</p> : null}
			{credentials.length === 0 ? <p className="text-xs opacity-60">{t("console.credentials.empty")}</p> : null}
			<ul className="flex flex-col gap-1">
				{credentials.map((credential) => (
					<li key={credential.name} className="browser-row">
						<span className="min-w-0 flex-1 truncate" title={credential.url}>
							{credential.name}
							{credential.username ? <span className="ml-2 opacity-60">{credential.username}</span> : null}
						</span>
						<button type="button" className="browser-button-ghost" onClick={() => onDelete(credential.name)}>
							{t("console.credentials.delete")}
						</button>
					</li>
				))}
			</ul>
			<div className="flex flex-col gap-1">
				<button
					type="button"
					className="browser-button-ghost self-start"
					onClick={onClearSignInState}
					disabled={!canClearSignInState}
				>
					{t("console.credentials.clearProfile")}
				</button>
				<p className="text-xs opacity-60">{t("console.credentials.clearProfileHint")}</p>
			</div>
		</section>
	);
}
