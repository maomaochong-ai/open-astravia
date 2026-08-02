import { ViewportPortal } from "@xyflow/react";
import type { ContentAlignmentGuides } from "../domain/alignment-guides";

interface AlignmentGuidesLayerProps {
	guides: ContentAlignmentGuides;
}

export function AlignmentGuidesLayer({ guides }: AlignmentGuidesLayerProps) {
	return (
		<ViewportPortal>
			{guides.vertical ? (
				<div
					className="pointer-events-none absolute z-[50] w-px bg-primary/90"
					style={{
						left: guides.vertical.x,
						top: guides.vertical.top,
						height: guides.vertical.bottom - guides.vertical.top,
					}}
				/>
			) : null}
			{guides.horizontal ? (
				<div
					className="pointer-events-none absolute z-[50] h-px bg-primary/90"
					style={{
						left: guides.horizontal.left,
						top: guides.horizontal.y,
						width: guides.horizontal.right - guides.horizontal.left,
					}}
				/>
			) : null}
		</ViewportPortal>
	);
}
