import { ViewportPortal } from "@xyflow/react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ContentAlignmentGuides } from "./alignment-guides";

const EMPTY_GUIDES: ContentAlignmentGuides = {};

export interface AlignmentGuidesLayerHandle {
	clear: () => void;
	update: (guides: ContentAlignmentGuides) => void;
}

function sameGuides(left: ContentAlignmentGuides, right: ContentAlignmentGuides): boolean {
	const verticalEqual =
		left.vertical === right.vertical ||
		(left.vertical !== undefined &&
			right.vertical !== undefined &&
			left.vertical.x === right.vertical.x &&
			left.vertical.top === right.vertical.top &&
			left.vertical.bottom === right.vertical.bottom);
	const horizontalEqual =
		left.horizontal === right.horizontal ||
		(left.horizontal !== undefined &&
			right.horizontal !== undefined &&
			left.horizontal.y === right.horizontal.y &&
			left.horizontal.left === right.horizontal.left &&
			left.horizontal.right === right.horizontal.right);
	return verticalEqual && horizontalEqual;
}

export const AlignmentGuidesLayer = forwardRef<AlignmentGuidesLayerHandle>(function AlignmentGuidesLayer(_, ref) {
	const [guides, setGuides] = useState<ContentAlignmentGuides>(EMPTY_GUIDES);
	const pendingGuidesRef = useRef<ContentAlignmentGuides>(EMPTY_GUIDES);
	const animationFrameRef = useRef<number | null>(null);

	const flush = useCallback(() => {
		animationFrameRef.current = null;
		const nextGuides = pendingGuidesRef.current;
		setGuides((currentGuides) => (sameGuides(currentGuides, nextGuides) ? currentGuides : nextGuides));
	}, []);

	useImperativeHandle(
		ref,
		() => ({
			clear: () => {
				pendingGuidesRef.current = EMPTY_GUIDES;
				if (animationFrameRef.current !== null) {
					cancelAnimationFrame(animationFrameRef.current);
					animationFrameRef.current = null;
				}
				setGuides((currentGuides) => (sameGuides(currentGuides, EMPTY_GUIDES) ? currentGuides : EMPTY_GUIDES));
			},
			update: (nextGuides) => {
				pendingGuidesRef.current = nextGuides;
				if (animationFrameRef.current === null) {
					animationFrameRef.current = requestAnimationFrame(flush);
				}
			},
		}),
		[flush],
	);

	useEffect(
		() => () => {
			if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
		},
		[],
	);

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
});
