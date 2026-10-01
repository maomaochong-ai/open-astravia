import { useTranslation } from "@astravia-org/plugin-sdk";
import type { JSX } from "react";

export type LoadState = "loading" | "ready" | "error";

export function LoadingState(): JSX.Element {
	const { t } = useTranslation();
	return (
		<div className="flex h-full items-center justify-center gap-2 text-[13px] text-[var(--muted-foreground)]">
			<span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-50" />
			{t("state.loading")}
		</div>
	);
}

export function ErrorState({ message }: { message: string }): JSX.Element {
	const { t } = useTranslation();
	return (
		<div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-[13px] text-[var(--destructive)]">
			<span>{message}</span>
			<span className="text-[11px] text-[var(--muted-foreground)]">{t("state.errorHint")}</span>
		</div>
	);
}
