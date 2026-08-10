import { useTranslation } from "@vetta-org/plugin-sdk";
import { useEffect, useState } from "react";
import { getPluginCtx } from "../plugin-context";
import type { DesignSession } from "../vetd/design-session";
import { themeTokenAttachment } from "./attach";
import { parseThemeTokens, type ThemeToken } from "./theme-tokens";

/**
 * Read-only palette of the design's shared @theme color tokens. Clicking a
 * swatch attaches the token to the conversation. Ownership of theme.css:
 * incremental edits belong to the agent; the plugin only performs templated
 * writes (scaffold, and applying a built-in design system to a zero-frame
 * design — see design-systems/apply.ts). This panel itself never writes.
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
		// 顶部按钮组正下方居中：颜色多起来时纵向长条会顶到画布底、还挡住右侧画框，
		// 改成贴着按钮组的宽面板，六列铺开。
		<div className="absolute left-1/2 top-16 z-30 w-[52rem] max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-xl border border-border bg-card/95 p-3 shadow-lg">
			<div className="mb-2 text-xs font-medium text-muted-foreground">
				{t("canvas.theme.title")}
			</div>
			{tokens.length === 0 ? (
				<div className="text-xs text-muted-foreground">{t("canvas.theme.empty")}</div>
			) : (
				<div className="grid max-h-[60vh] grid-cols-6 gap-1 overflow-y-auto">
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
							className="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-accent"
						>
							<span
								className="size-4 shrink-0 rounded-full border border-border"
								style={{ background: token.value }}
							/>
							<span className="flex min-w-0 flex-1 flex-col">
								<span className="truncate text-xs text-foreground">{token.name}</span>
								<span className="truncate text-[10px] text-muted-foreground">{token.value}</span>
							</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
