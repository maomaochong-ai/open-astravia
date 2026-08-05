import { useTranslation } from "@vetta-org/plugin-sdk";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@vetta/ui";
import { ContentAssetKindIcon } from "./ContentAssetKindIcon";
import type { ConnectedPromptSource } from "./prompt-sources";

const LOCAL_PROMPT_SOURCE_VALUE = "__local_prompt__";

interface PromptSourceSelectorProps {
	sources: readonly ConnectedPromptSource[];
	selectedSource: ConnectedPromptSource | null;
	disabled: boolean;
	onChange: (nodeId: string | null) => void;
}

export function PromptSourceSelector({
	sources,
	selectedSource,
	disabled,
	onChange,
}: PromptSourceSelectorProps) {
	const { t } = useTranslation();
	if (sources.length === 0) return null;

	return (
		<div className="mb-2 rounded-xl border border-border/65 bg-background/40 p-2">
			<div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
				<span className="icon-[lucide--message-square-text] block size-3.5 shrink-0" aria-hidden="true" />
				<span className="shrink-0">{t("nodeEditor.prompt.source")}</span>
				<Select
					value={selectedSource?.nodeId ?? LOCAL_PROMPT_SOURCE_VALUE}
					disabled={disabled}
					onValueChange={(value) => onChange(value === LOCAL_PROMPT_SOURCE_VALUE ? null : value)}
				>
					<SelectTrigger
						size="sm"
						className="min-w-0 flex-1 bg-background text-[11px]"
						aria-label={t("nodeEditor.prompt.source")}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={LOCAL_PROMPT_SOURCE_VALUE}>{t("nodeEditor.prompt.source.local")}</SelectItem>
						{sources.map((source, index) => (
							<SelectItem key={source.nodeId} value={source.nodeId}>
								{source.label?.trim() || t("nodeEditor.prompt.source.connected", { index: index + 1 })}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			{selectedSource && selectedSource.references.length > 0 ? (
				<div className="mt-2 flex items-center gap-1.5 border-t border-border/50 pt-2">
					{selectedSource.references.slice(0, 2).map(({ binding, asset }) => (
						<span
							key={binding.id}
							className="inline-flex min-w-0 max-w-32 items-center gap-1 rounded-md bg-muted/70 px-1.5 py-1 text-[10px] text-foreground"
						>
							<ContentAssetKindIcon kind={asset.kind} className="size-3 shrink-0 text-muted-foreground" />
							<span className="truncate">{asset.name}</span>
						</span>
					))}
					<span className="ml-0.5 text-[10px] text-muted-foreground">
						{t("nodeEditor.prompt.source.materials", { count: selectedSource.references.length })}
					</span>
				</div>
			) : null}
		</div>
	);
}
