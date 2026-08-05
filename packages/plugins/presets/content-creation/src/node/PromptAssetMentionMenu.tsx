import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta/ui";
import { ContentAssetKindIcon } from "./ContentAssetKindIcon";
import type { ConnectedContentAsset } from "./material-assets";

interface PromptAssetMentionMenuProps {
	options: readonly ConnectedContentAsset[];
	query: string;
	highlightedIndex: number;
	onSelect: (option: ConnectedContentAsset) => void;
}

export function PromptAssetMentionMenu({
	options,
	query,
	highlightedIndex,
	onSelect,
}: PromptAssetMentionMenuProps) {
	const { t } = useTranslation();
	return (
		<>
			<div className="flex items-center justify-between gap-2 px-1 text-[10px] text-muted-foreground">
				<span>{t("nodeEditor.prompt.mention.title")}</span>
				{query ? <span className="max-w-28 truncate">@{query}</span> : null}
			</div>
			<div className="max-h-56 overflow-y-auto">
				{options.map((option, index) => (
					<Button
						key={`${option.sourceNodeId}:${option.asset.id}`}
						type="button"
						variant="ghost"
						className={`h-8 w-full justify-start gap-2 px-2 text-left text-[11px] ${
							index === highlightedIndex ? "bg-accent" : ""
						}`}
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => onSelect(option)}
					>
						<ContentAssetKindIcon
							kind={option.asset.kind}
							className="size-3.5 shrink-0 text-muted-foreground"
						/>
						<span className="min-w-0 flex-1 truncate">{option.asset.name}</span>
						<span className="shrink-0 text-[10px] text-muted-foreground">
							{t(`asset.kind.${option.asset.kind}`)}
						</span>
					</Button>
				))}
				{options.length === 0 ? (
					<p className="m-0 px-2 py-5 text-center text-[11px] text-muted-foreground">
						{t("nodeEditor.prompt.mention.empty")}
					</p>
				) : null}
			</div>
			<p className="m-0 border-t border-border/50 px-1 pt-1.5 text-[10px] text-muted-foreground">
				{t("nodeEditor.prompt.mention.hint")}
			</p>
		</>
	);
}
