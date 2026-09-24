import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta-org/ui";
import { useState } from "react";
import { GitIcon, RefreshIcon } from "./icons";

/** Shown when git cannot run for the panel's cwd: points to the host's installer. */
export function NoGitCta({ onRecheck }: { onRecheck: () => Promise<void> }): JSX.Element {
	const { t } = useTranslation();
	const [busy, setBusy] = useState(false);

	const handleRecheck = (): void => {
		setBusy(true);
		void onRecheck().finally(() => setBusy(false));
	};

	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
			<div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500">
				<GitIcon className="h-6 w-6" />
			</div>
			<div className="space-y-1">
				<p className="text-[14px] font-semibold text-foreground">{t("noGit.title")}</p>
				<p className="text-[12px] leading-relaxed text-muted-foreground">{t("noGit.subtitle")}</p>
			</div>
			<Button type="button" variant="outline" disabled={busy} onClick={handleRecheck}>
				<RefreshIcon className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
				{busy ? t("noGit.checking") : t("noGit.recheck")}
			</Button>
		</div>
	);
}
