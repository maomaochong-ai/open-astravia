import type { JSX } from "react";
import { Button } from "@vetta-org/ui";
import type { SettingSectionMeta } from "./SettingChrome";
import { SettingHeading } from "./SettingChrome";

export interface McpJsonEditorViewProps {
	readonly section: SettingSectionMeta;
	readonly jsonText: string;
	readonly onJsonTextChange: (value: string) => void;
	readonly jsonError: string | null;
	readonly configPathHint: string;
	readonly placeholder: string;
	readonly saveLabel: string;
	readonly saving: boolean;
	readonly onSave: () => void;
}

export function McpJsonEditorView({
	section,
	jsonText,
	onJsonTextChange,
	jsonError,
	configPathHint,
	placeholder,
	saveLabel,
	saving,
	onSave,
}: McpJsonEditorViewProps): JSX.Element {
	return (
		<div className="mb-6">
			<div className="mb-3 flex items-center justify-between">
				<SettingHeading section={section} />
				<Button variant="primary" size="sm" onClick={onSave} disabled={saving}>
					{saveLabel}
				</Button>
			</div>
			<div className="overflow-hidden rounded-xl border border-border bg-card">
				<textarea
					value={jsonText}
					onChange={(event) => onJsonTextChange(event.target.value)}
					spellCheck={false}
					className="w-full resize-none bg-transparent px-4 py-3 font-mono text-[12px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/40"
					style={{ minHeight: "320px" }}
					placeholder={placeholder}
				/>
			</div>
			{jsonError && (
				<div className="mt-2 flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
					<span className="icon-[mdi--alert-circle-outline] h-3.5 w-3.5 shrink-0" />
					{jsonError}
				</div>
			)}
			<div className="mt-3 text-center text-[11px] text-muted-foreground/60">{configPathHint}</div>
		</div>
	);
}
