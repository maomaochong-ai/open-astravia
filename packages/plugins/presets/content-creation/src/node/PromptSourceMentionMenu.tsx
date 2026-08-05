import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta/ui";
import type { ConnectedPromptSource } from "./prompt-sources";

interface PromptSourceMentionMenuProps {
	options: readonly ConnectedPromptSource[];
	query: string;
	highlightedIndex: number;
	onSelect: (source: ConnectedPromptSource) => void;
}

export function PromptSourceMentionMenu({
	options,
	query,
	highlightedIndex,
	onSelect,
}: PromptSourceMentionMenuProps) {
	const { t } = useTranslation();
	return (
		<>
			<div className="flex items-center justify-between gap-2 px-1 text-[10px] text-muted-foreground">
				<span>{t("nodeEditor.promptReference.title")}</span>
				{query ? <span className="max-w-28 truncate">@{query}</span> : null}
			</div>
			<div className="max-h-56 overflow-y-auto">
				{options.map((source, index) => (
					<Button
						key={source.nodeId}
						type="button"
						variant="ghost"
						className={`h-auto min-h-9 w-full justify-start gap-2 px-2 py-1.5 text-left ${
							index === highlightedIndex ? "bg-accent" : ""
						}`}
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => onSelect(source)}
					>
						<span
							className="icon-[lucide--message-square-text] block size-3.5 shrink-0 text-muted-foreground"
							aria-hidden="true"
						/>
						<span className="min-w-0 flex-1">
							<span className="block truncate text-[11px] font-medium">
								{source.label?.trim() ||
									t("nodeEditor.prompt.source.connected", { index: index + 1 })}
							</span>
							<span className="block truncate text-[10px] text-muted-foreground">{source.prompt}</span>
						</span>
					</Button>
				))}
				{options.length === 0 ? (
					<p className="m-0 px-2 py-5 text-center text-[11px] text-muted-foreground">
						{t("nodeEditor.promptReference.empty")}
					</p>
				) : null}
			</div>
			<p className="m-0 border-t border-border/50 px-1 pt-1.5 text-[10px] text-muted-foreground">
				{t("nodeEditor.prompt.mention.hint")}
			</p>
		</>
	);
}
