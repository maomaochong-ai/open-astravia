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
					className="content-creation-alignment-guide is-vertical"
					style={{
						left: guides.vertical.x,
						top: guides.vertical.top,
						height: guides.vertical.bottom - guides.vertical.top,
					}}
				/>
			) : null}
			{guides.horizontal ? (
				<div
					className="content-creation-alignment-guide is-horizontal"
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
