import { useTranslation } from "@vetta-org/plugin-sdk";
import { ContentAssetThumbnail } from "./ContentAssetThumbnail";
import type { ConnectedPromptSource } from "./prompt-sources";

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
			<label className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
				<span className="icon-[lucide--message-square-text] block size-3.5 shrink-0" aria-hidden="true" />
				<span className="shrink-0">{t("nodeEditor.prompt.source")}</span>
				<select
					className="h-7 min-w-0 flex-1 rounded-md border border-border/70 bg-background px-2 text-[11px] text-foreground outline-none focus-visible:border-primary/50"
					value={selectedSource?.nodeId ?? ""}
					disabled={disabled}
					aria-label={t("nodeEditor.prompt.source")}
					onChange={(event) => onChange(event.target.value || null)}
				>
					<option value="">{t("nodeEditor.prompt.source.local")}</option>
					{sources.map((source, index) => (
						<option key={source.nodeId} value={source.nodeId}>
							{source.label?.trim() || t("nodeEditor.prompt.source.connected", { index: index + 1 })}
						</option>
					))}
				</select>
			</label>
			{selectedSource && selectedSource.references.length > 0 ? (
				<div className="mt-2 flex items-center gap-1.5 border-t border-border/50 pt-2">
					{selectedSource.references.slice(0, 3).map(({ binding, asset }) => (
						<ContentAssetThumbnail
							key={binding.id}
							asset={asset}
							className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted object-cover text-muted-foreground"
						/>
					))}
					<span className="ml-0.5 text-[10px] text-muted-foreground">
						{t("nodeEditor.prompt.source.materials", { count: selectedSource.references.length })}
					</span>
				</div>
			) : null}
		</div>
	);
}
