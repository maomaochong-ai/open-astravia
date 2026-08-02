import { useTranslation } from "@vetta-org/plugin-sdk";
import { memo } from "react";
import type { ContentNodeKind, ContentNodeStatus } from "../domain/model";
import { LockIcon } from "./icons";
import { NodeKindIcon } from "./NodeKindIcon";

interface ContentNodeHeaderProps {
	kind: ContentNodeKind;
	title: string;
	status: ContentNodeStatus;
	locked: boolean;
	active: boolean;
}

export const ContentNodeHeader = memo(function ContentNodeHeader({
	kind,
	title,
	status,
	locked,
	active,
}: ContentNodeHeaderProps) {
	const { t } = useTranslation();
	return (
		<div className={`flex h-8 items-center gap-1.5 border-b border-border/50 bg-card/95 px-2 text-xs transition-colors ${active ? "text-foreground" : "text-muted-foreground"}`}>
			<NodeKindIcon kind={kind} className="h-3.5 w-3.5 shrink-0" />
			<span className="min-w-0 flex-1 truncate" title={title}>{title}</span>
			{status !== "idle" ? (
				<span className={`rounded px-1 py-0.5 text-[9px] font-medium ${status === "failed" ? "bg-destructive/10 text-destructive" : status === "running" || status === "queued" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{t(`node.status.${status}`)}</span>
			) : null}
			{locked ? <LockIcon className="h-3.5 w-3.5 shrink-0" /> : null}
		</div>
	);
});
