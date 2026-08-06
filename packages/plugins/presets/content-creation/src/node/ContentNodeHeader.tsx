import { useTranslation } from "@vetta-org/plugin-sdk";
import { memo } from "react";
import type { ContentNodeKind, ContentNodeStatus } from "../project/types";
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
		<div
			className={`absolute inset-x-0 bottom-full z-10 mb-1.5 flex h-6 items-center gap-1.5 px-0.5 text-[11px] transition-colors duration-150 ${
				active ? "text-foreground" : "text-muted-foreground"
			}`}
		>
			<span className="grid size-5 shrink-0 place-items-center rounded-md bg-muted/80 text-current">
				<NodeKindIcon kind={kind} className="size-3.5" />
			</span>
			<span className="min-w-0 flex-1 truncate font-medium tracking-tight" title={title}>
				{title}
			</span>
			{status !== "idle" ? (
				<span
					className={`shrink-0 rounded-full px-1.5 py-px text-[9px] font-medium leading-4 ${
						status === "failed"
							? "bg-destructive/10 text-destructive"
							: status === "running" || status === "queued" || status === "succeeded"
								? "bg-primary/10 text-primary"
								: "bg-muted text-muted-foreground"
					}`}
				>
					{t(`node.status.${status}`)}
				</span>
			) : null}
			{locked ? (
				<span className="icon-[lucide--lock] block size-3.5 shrink-0 opacity-70" aria-hidden="true" />
			) : null}
		</div>
	);
});
