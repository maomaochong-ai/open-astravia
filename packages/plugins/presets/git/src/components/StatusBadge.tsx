import { useTranslation } from "@vetta-org/plugin-sdk";
import type { ChangeCode } from "../git/types";

const CODE_META: Record<ChangeCode, { label: string; color: string; titleKey: string }> = {
	M: { label: "M", color: "text-amber-500", titleKey: "status.modified" },
	A: { label: "A", color: "text-emerald-500", titleKey: "status.added" },
	D: { label: "D", color: "text-rose-500", titleKey: "status.deleted" },
	R: { label: "R", color: "text-sky-500", titleKey: "status.renamed" },
	U: { label: "U", color: "text-violet-400", titleKey: "status.untracked" },
	C: { label: "C", color: "text-orange-500", titleKey: "status.conflict" },
};

export function StatusBadge({ code }: { code: ChangeCode }): JSX.Element {
	const { t } = useTranslation();
	const meta = CODE_META[code];
	return (
		<span className={`git-mono w-3 shrink-0 text-center text-[12px] font-semibold ${meta.color}`} title={t(meta.titleKey)}>
			{meta.label}
		</span>
	);
}
