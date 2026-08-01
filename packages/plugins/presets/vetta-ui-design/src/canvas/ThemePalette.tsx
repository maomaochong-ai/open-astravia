import { useTranslation } from "@vetta-org/plugin-sdk";
import { useEffect, useState } from "react";
import { getPluginCtx } from "../plugin-context";
import type { DesignSession } from "../vetd/design-session";
import { themeTokenAttachment } from "./attach";
import { parseThemeTokens, type ThemeToken } from "./theme-tokens";

/**
 * Read-only palette of the design's shared @theme color tokens. Clicking a
 * swatch attaches the token to the conversation (agent edits theme.css; the
 * plugin never writes it — single-writer discipline, see CONTEXT.md).
 */
export function ThemePalette({ session }: { session: DesignSession }) {
	const { t } = useTranslation();
	const [tokens, setTokens] = useState<ThemeToken[]>([]);

	useEffect(() => {
		let cancelled = false;
		const load = (): void => {
			void session.readThemeCss().then((css) => {
				if (!cancelled) setTokens(parseThemeTokens(css));
			});
		};
		load();
		const handle = session.on((change) => {
			if (change === "theme") load();
		});
		return () => {
			cancelled = true;
			handle.dispose();
		};
	}, [session]);

	return (
		<div className="absolute right-3 top-3 z-20 w-44 rounded-xl border border-black/10 bg-white/95 p-2.5 shadow-lg dark:border-white/10 dark:bg-neutral-900/95">
			<div className="mb-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">
				{t("canvas.theme.title")}
			</div>
			{tokens.length === 0 ? (
				<div className="text-xs text-neutral-400">{t("canvas.theme.empty")}</div>
			) : (
				<div className="flex flex-col gap-1">
					{tokens.map((token) => (
						<button
							key={token.name}
							type="button"
							title={t("canvas.theme.attach", { token: token.name })}
							onClick={() =>
								getPluginCtx().ui.setPromptAttachment(
									themeTokenAttachment(session, token.name, `--color-${token.name}`),
								)
							}
							className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-black/5 dark:hover:bg-white/10"
						>
							<span
								className="size-4 shrink-0 rounded-full border border-black/10"
								style={{ background: token.value }}
							/>
							<span className="min-w-0 flex-1 truncate text-xs text-neutral-600 dark:text-neutral-300">
								{token.name}
							</span>
							<span className="truncate text-[10px] text-neutral-400">{token.value}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
