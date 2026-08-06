import { useTranslation } from "@vetta-org/plugin-sdk";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@vetta/ui";
import type { BranchRef, GraphScope, GraphSelection } from "../../git/types";
import { BranchIcon } from "../icons";

const SCOPES: GraphScope[] = ["local", "remote"];
/** Radix Select disallows empty item values; maps to `branch: null` (all branches). */
const ALL_BRANCHES = "__all__";

/** Top switcher: local/remote scope segmented toggle + a branch dropdown (all = whole scope). */
export function BranchSelector({
	selection,
	branches,
	onChange,
}: {
	selection: GraphSelection;
	branches: readonly BranchRef[];
	onChange: (next: GraphSelection) => void;
}): JSX.Element {
	const { t } = useTranslation();
	const selectValue = selection.branch ?? ALL_BRANCHES;

	return (
		<div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
			<div className="flex shrink-0 items-center rounded-md bg-muted/60 p-0.5 text-[11px]">
				{SCOPES.map((scope) => (
					<button
						key={scope}
						type="button"
						onClick={() => scope !== selection.scope && onChange({ scope, branch: null })}
						className={`rounded px-2 py-0.5 transition-colors ${
							selection.scope === scope ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
						}`}
					>
						{scope === "local" ? t("branch.scopeLocal") : t("branch.scopeRemote")}
					</button>
				))}
			</div>

			<div className="flex min-w-0 flex-1 items-center gap-1.5">
				<BranchIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
				<Select
					value={selectValue}
					onValueChange={(value) =>
						onChange({
							...selection,
							branch: value === ALL_BRANCHES ? null : value,
						})
					}
				>
					<SelectTrigger
						size="sm"
						title={t("branch.placeholder")}
						className="h-7 min-w-0 w-full max-w-full flex-1 border-border/60 bg-transparent font-normal shadow-none"
					>
						<SelectValue placeholder={t("branch.placeholder")} />
					</SelectTrigger>
					<SelectContent className="max-h-64">
						<SelectItem value={ALL_BRANCHES}>{t("branch.all")}</SelectItem>
						{branches.map((b) => (
							<SelectItem key={b.name} value={b.name}>
								{b.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		</div>
	);
}
