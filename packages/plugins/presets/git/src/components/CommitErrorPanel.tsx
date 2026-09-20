import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta-org/ui";
import { useState } from "react";
import { ChevronIcon, CloseIcon, CopyIcon } from "./icons";

/**
 * Failure output for a commit attempt.
 *
 * A rejected pre-commit hook prints the lint or typecheck report that tells the
 * user what to fix, which can run to hundreds of lines — so this is a scrollable
 * monospace block with a copy button, not a tooltip. It opens expanded and stays
 * until dismissed or superseded.
 */
export function CommitErrorPanel({ message, onDismiss }: { message: string; onDismiss: () => void }): JSX.Element {
	const { t } = useTranslation();
	const [expanded, setExpanded] = useState(true);
	const [copied, setCopied] = useState(false);

	const copy = (): void => {
		void navigator.clipboard
			?.writeText(message)
			.then(() => setCopied(true))
			.catch(() => {});
	};

	const firstLine = message.split("\n")[0] ?? "";

	return (
		<div className="mt-1.5 shrink-0 rounded-lg bg-rose-500/10 px-1">
			<div className="flex h-7 items-center gap-1 px-1.5">
				<button
					type="button"
					onClick={() => setExpanded((value) => !value)}
					className="flex min-w-0 flex-1 items-center gap-1 text-left text-[11px] font-medium text-rose-500"
				>
					<ChevronIcon className={`h-3 w-3 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`} />
					<span className="truncate">{expanded ? t("commit.failed") : firstLine}</span>
				</button>
				<Button type="button" variant="ghost" size="icon-xs" title={copied ? t("commit.copied") : t("commit.copyError")} onClick={copy}>
					<CopyIcon className="h-3.5 w-3.5" />
				</Button>
				<Button type="button" variant="ghost" size="icon-xs" title={t("action.dismiss")} onClick={onDismiss}>
					<CloseIcon className="h-3.5 w-3.5" />
				</Button>
			</div>
			{expanded && (
				<pre className="git-mono max-h-40 overflow-auto whitespace-pre-wrap break-words px-2 pb-2 text-[11px] leading-relaxed text-rose-500/90">
					{message}
				</pre>
			)}
		</div>
	);
}
