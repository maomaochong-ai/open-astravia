import { useTranslation } from "@astravia-org/plugin-sdk";
import { useMemo } from "react";
import { parseDiff } from "../git/parseDiff";

const ROW_BG: Record<string, string> = {
	add: "bg-emerald-500/10",
	del: "bg-rose-500/10",
	context: "",
	hunk: "bg-sky-500/10",
};

const SIGN: Record<string, string> = { add: "+", del: "-", context: " ", hunk: "" };

/**
 * Self-contained unified-diff renderer (no syntax highlighting). Isolated so it
 * can later be swapped for a richer renderer (e.g. @pierre/diffs) without
 * touching the tree/panel.
 */
export function DiffView({ patch }: { patch: string }): JSX.Element {
	const { t } = useTranslation();
	const parsed = useMemo(() => parseDiff(patch), [patch]);

	if (parsed.binary) {
		return <div className="px-3 py-2 text-[12px] text-muted-foreground">{t("diff.binary")}</div>;
	}
	if (parsed.lines.length === 0) {
		return <div className="px-3 py-2 text-[12px] text-muted-foreground">{t("diff.empty")}</div>;
	}

	return (
		<div className="git-mono overflow-x-auto text-[11.5px] leading-[1.55]">
			{parsed.lines.map((line, index) => (
				<div
					// biome-ignore lint/suspicious/noArrayIndexKey: diff lines are positional and stable per render
					key={index}
					className={`flex whitespace-pre ${ROW_BG[line.type]} ${line.type === "hunk" ? "text-sky-500" : ""}`}
				>
					<span className="w-9 shrink-0 select-none px-1 text-right text-muted-foreground/50">
						{line.type === "hunk" ? "" : (line.oldNo ?? "")}
					</span>
					<span className="w-9 shrink-0 select-none px-1 text-right text-muted-foreground/50">
						{line.type === "hunk" ? "" : (line.newNo ?? "")}
					</span>
					<span
						className={`w-4 shrink-0 select-none text-center ${line.type === "add" ? "text-emerald-500" : line.type === "del" ? "text-rose-500" : "text-transparent"}`}
					>
						{SIGN[line.type]}
					</span>
					<span className="flex-1 pr-3">{line.text}</span>
				</div>
			))}
		</div>
	);
}
