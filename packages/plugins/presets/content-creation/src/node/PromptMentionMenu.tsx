import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta/ui";
import { ContentAssetThumbnail } from "./ContentAssetThumbnail";
import { NodeKindIcon } from "./NodeKindIcon";
import type { ConnectedPromptSource } from "./prompt-sources";
import type { ContentAssetReferenceCandidate } from "./reference-candidates";

export type PromptMentionOption =
	| { type: "asset"; candidate: ContentAssetReferenceCandidate }
	| { type: "prompt"; source: ConnectedPromptSource; label: string };

interface PromptMentionMenuProps {
	options: readonly PromptMentionOption[];
	query: string;
	highlightedIndex: number;
	title: string;
	emptyMessage: string;
	onSelect: (option: PromptMentionOption) => void;
}

export function PromptMentionMenu({
	options,
	query,
	highlightedIndex,
	title,
	emptyMessage,
	onSelect,
}: PromptMentionMenuProps) {
	const { t } = useTranslation();
	return (
		<div className="contents select-none">
			<div className="flex items-center justify-between gap-2 px-1 text-[10px] text-muted-foreground">
				<span>{title}</span>
				{query ? <span className="max-w-28 truncate">@{query}</span> : null}
			</div>
			<div className="max-h-56 overflow-y-auto">
				{options.map((option, index) => (
					<Button
						key={mentionOptionKey(option)}
						type="button"
						variant="ghost"
						className={`h-auto min-h-9 w-full justify-start gap-2 px-2 py-1 text-left ${
							index === highlightedIndex ? "bg-accent" : ""
						}`}
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => onSelect(option)}
					>
						{option.type === "asset" ? (
							<>
								<ContentAssetThumbnail
									asset={option.candidate.asset}
									className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted object-cover text-muted-foreground"
								/>
								<span className="min-w-0 flex-1 truncate text-[11px]">
									{option.candidate.asset.name}
								</span>
								<span className="shrink-0 text-[10px] text-muted-foreground">
									{t(`nodeEditor.prompt.mention.origin.${option.candidate.origin}`)}
								</span>
							</>
						) : (
							<>
								<span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground">
									<NodeKindIcon kind="prompt" className="size-4" />
								</span>
								<span className="min-w-0 flex-1">
									<span className="block truncate text-[11px] font-medium">{option.label}</span>
									<span className="block truncate text-[10px] text-muted-foreground">
										{option.source.prompt}
									</span>
								</span>
							</>
						)}
					</Button>
				))}
				{options.length === 0 ? (
					<p className="m-0 px-2 py-5 text-center text-[11px] text-muted-foreground">{emptyMessage}</p>
				) : null}
			</div>
			<p className="m-0 border-t border-border/50 px-1 pt-1.5 text-[10px] text-muted-foreground">
				{t("nodeEditor.prompt.mention.hint")}
			</p>
		</div>
	);
}

function mentionOptionKey(option: PromptMentionOption): string {
	return option.type === "asset"
		? `asset:${option.candidate.asset.id}`
		: `prompt:${option.source.nodeId}`;
}
