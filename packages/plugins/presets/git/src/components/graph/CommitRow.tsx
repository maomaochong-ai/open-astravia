import type { MouseEvent } from "react";
import type { CommitNode } from "../../git/types";

type RefChip = { key: string; label: string; kind: "head" | "branch" | "tag" };

function classifyRefs(refs: readonly string[]): RefChip[] {
	return refs.map((r) => {
		if (r === "HEAD") return { key: r, label: "HEAD", kind: "head" };
		if (r.startsWith("tag: ")) return { key: r, label: r.slice(5), kind: "tag" };
		return { key: r, label: r, kind: "branch" };
	});
}

const CHIP_CLASS: Record<RefChip["kind"], string> = {
	head: "border-primary/60 text-primary",
	branch: "border-border text-muted-foreground",
	tag: "border-amber-500/40 text-amber-500",
};

export function CommitRow({
	node,
	selected,
	graphWidth,
	top,
	height,
	onContextMenu,
	onSelect,
}: {
	node: CommitNode;
	selected: boolean;
	graphWidth: number;
	top: number;
	height: number;
	onContextMenu?: (node: CommitNode, event: MouseEvent<HTMLElement>) => void;
	onSelect: (hash: string) => void;
}): JSX.Element {
	const chips = classifyRefs(node.refs);
	return (
		<button
			type="button"
			aria-pressed={selected}
			onContextMenu={(event) => onContextMenu?.(node, event)}
			onClick={() => onSelect(node.hash)}
			style={{ position: "absolute", top, height, left: 0, right: 0 }}
			className="group w-full cursor-pointer text-left"
		>
			<div
				style={{ marginLeft: graphWidth }}
				className={`relative flex h-full items-center gap-1.5 rounded px-2 text-[12px] ${
					selected ? "bg-accent text-foreground" : "text-foreground group-hover:bg-accent"
				}`}
			>
				{chips.map((c) => (
					<span
						key={c.key}
						className={`shrink-0 rounded border px-1 text-[10px] leading-[1.5] ${CHIP_CLASS[c.kind]}`}
					>
						{c.label}
					</span>
				))}
				{/* Metadata stays in the detail pane so hovering never obscures the subject. */}
				<span className="min-w-0 flex-1 truncate" title={node.subject}>
					{node.subject}
				</span>
			</div>
		</button>
	);
}
