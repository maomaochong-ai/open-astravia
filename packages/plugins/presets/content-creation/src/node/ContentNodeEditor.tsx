import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta/ui";
import { type ChangeEvent, type KeyboardEvent, useEffect, useState } from "react";
import type { ContentModelDescriptor, ImportedContentReference } from "../generation/types";
import type {
	ContentAsset,
	ContentNodeData,
	ContentNodeInputBinding,
	ContentNodeKind,
	ContentNodeStatus,
} from "../project/types";
import { AddIcon } from "../shared/icons";
import type { ContentNodePropertyDefinition } from "./definitions";
import { ContentGeneratorComposer } from "./ContentGeneratorComposer";

const FIELD_CLASS =
	"min-w-0 rounded-md border border-border/70 bg-background/60 px-2.5 py-1.5 text-[12px] font-medium text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary/50";

interface ContentNodeEditorProps {
	kind: ContentNodeKind;
	status: ContentNodeStatus;
	data: ContentNodeData;
	properties: readonly ContentNodePropertyDefinition[];
	models: readonly ContentModelDescriptor[];
	referenceAssets: readonly { binding: ContentNodeInputBinding; asset: ContentAsset }[];
	hasGenerationError: boolean;
	onUpdate: (data: ContentNodeData) => Promise<void>;
	onRunNode: () => Promise<void>;
	onImportReferences: (files: readonly ImportedContentReference[]) => Promise<void>;
	onAddToTimeline?: () => Promise<void>;
}

export function ContentNodeEditor(props: ContentNodeEditorProps) {
	if (props.kind === "image-generator" || props.kind === "video-generator") {
		return <ContentGeneratorComposer {...props} kind={props.kind} />;
	}
	return <SimpleContentNodeEditor {...props} />;
}

function SimpleContentNodeEditor({
	data,
	properties,
	onUpdate,
	onAddToTimeline,
}: ContentNodeEditorProps) {
	const { t } = useTranslation();
	const [draft, setDraft] = useState(data);
	const preferredWidth = properties.some((property) => property.editor === "textarea") ? 360 : 260;
	useEffect(() => setDraft(data), [data]);
	const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key !== "Enter" || event.shiftKey) return;
		event.preventDefault();
		void onUpdate(draft);
	};

	return (
		<div
			className="nodrag nowheel min-w-0 max-w-[calc(100vw-32px)] rounded-xl border border-border/70 bg-card p-2.5 text-card-foreground shadow-sm"
			style={{ width: `min(${preferredWidth}px, calc(100vw - 32px))` }}
			onPointerDown={(event) => event.stopPropagation()}
			onKeyDown={(event) => event.stopPropagation()}
		>
			<div className="flex flex-col gap-2">
				{properties.map((property) => (
					<label key={property.key} className="flex min-w-0 flex-col gap-1 text-[10px] font-medium text-muted-foreground">
						<span>{t(property.labelKey)}</span>
						{property.editor === "textarea" ? (
							<textarea
								className={`${FIELD_CLASS} min-h-[72px] resize-none leading-relaxed`}
								value={String(draft[property.key] ?? "")}
								placeholder={property.placeholderKey ? t(property.placeholderKey) : undefined}
								onChange={(event) => setDraft({ ...draft, [property.key]: event.target.value })}
								onBlur={() => void onUpdate(draft)}
								onKeyDown={handlePromptKeyDown}
							/>
						) : (
							<input
								className={FIELD_CLASS}
								value={String(draft[property.key] ?? "")}
								onChange={(event: ChangeEvent<HTMLInputElement>) =>
									setDraft({ ...draft, [property.key]: event.target.value })
								}
								onBlur={() => void onUpdate(draft)}
							/>
						)}
					</label>
				))}
			</div>
			{onAddToTimeline && data.assetId ? (
				<div className="mt-2 flex justify-end">
					<Button type="button" size="sm" variant="outline" onClick={() => void onAddToTimeline()}>
						<AddIcon /> {t("action.addToTimeline")}
					</Button>
				</div>
			) : null}
		</div>
	);
}
