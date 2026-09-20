import { useTranslation } from "@vetta-org/plugin-sdk";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ChangeSection } from "../git/types";

/** Viewport coordinates of the right-click, for views that position their own menu. */
export interface MenuPoint {
	x: number;
	y: number;
}

/** What a menu action addresses: the right-clicked paths, in one section. */
export interface ChangeMenuTarget {
	section: ChangeSection;
	paths: readonly string[];
}

export interface ChangeMenuHandlers {
	onStage: (target: ChangeMenuTarget) => void;
	onUnstage: (target: ChangeMenuTarget) => void;
	onDiscard: (target: ChangeMenuTarget) => void;
	onIgnore: (target: ChangeMenuTarget) => void;
	onResolve: (target: ChangeMenuTarget, side: "ours" | "theirs" | "staged") => void;
	onCopyPath: (target: ChangeMenuTarget, absolute: boolean) => void;
	onRevealInFolder: (target: ChangeMenuTarget) => void;
}

function MenuItem({
	label,
	onSelect,
	danger = false,
}: {
	label: string;
	onSelect: () => void;
	danger?: boolean;
}): JSX.Element {
	return (
		<button
			type="button"
			// Radix-free menu: the tree opens this inside its own popover surface, so
			// a plain button row is all that is needed.
			onClick={onSelect}
			className={`flex w-full items-center rounded px-2 py-1 text-left text-[12px] transition-colors hover:bg-accent ${
				danger ? "text-rose-500" : "text-foreground"
			}`}
		>
			{label}
		</button>
	);
}

function Separator(): JSX.Element {
	return <div className="my-1 h-px bg-border" />;
}

/**
 * The context-menu body for a change row, shared by both views.
 *
 * Items are filtered by section: staging is only offered where it means
 * something, conflict resolution only for unmerged paths, and destructive items
 * (discard) are visually separated and routed through the caller's confirmation.
 */
export function ChangeMenuItems({
	target,
	handlers,
	onDone,
}: {
	target: ChangeMenuTarget;
	handlers: ChangeMenuHandlers;
	/** Called after any item runs, so the host can close itself. */
	onDone: () => void;
}): JSX.Element {
	const { t } = useTranslation();
	const count = target.paths.length;
	const suffix = count > 1 ? ` (${count})` : "";
	const run = (fn: () => void) => () => {
		fn();
		onDone();
	};

	return (
		<div className="min-w-44 rounded-md border border-border bg-popover p-1 shadow-md">
			{target.section === "conflict" ? (
				<>
					<MenuItem label={`${t("menu.markResolved")}${suffix}`} onSelect={run(() => handlers.onResolve(target, "staged"))} />
					<MenuItem label={t("menu.useOurs")} onSelect={run(() => handlers.onResolve(target, "ours"))} />
					<MenuItem label={t("menu.useTheirs")} onSelect={run(() => handlers.onResolve(target, "theirs"))} />
				</>
			) : target.section === "staged" ? (
				<MenuItem label={`${t("menu.unstage")}${suffix}`} onSelect={run(() => handlers.onUnstage(target))} />
			) : (
				<MenuItem label={`${t("menu.stage")}${suffix}`} onSelect={run(() => handlers.onStage(target))} />
			)}

			<Separator />
			<MenuItem label={t("menu.copyRelativePath")} onSelect={run(() => handlers.onCopyPath(target, false))} />
			<MenuItem label={t("menu.copyPath")} onSelect={run(() => handlers.onCopyPath(target, true))} />
			<MenuItem label={t("menu.revealInFolder")} onSelect={run(() => handlers.onRevealInFolder(target))} />

			{target.section === "unstaged" && (
				<>
					<Separator />
					<MenuItem label={t("menu.ignore")} onSelect={run(() => handlers.onIgnore(target))} />
					<MenuItem label={`${t("menu.discard")}${suffix}`} danger onSelect={run(() => handlers.onDiscard(target))} />
				</>
			)}
		</div>
	);
}

/** Gap kept between the menu and the viewport edge when it has to be nudged. */
const VIEWPORT_MARGIN = 8;

/**
 * Floating host for {@link ChangeMenuItems}, portalled to the document body.
 *
 * The portal matters: the panel columns clip their overflow, and a menu rendered
 * inside the list would be cut off near the panel's right edge — which is where
 * the activity panel always sits. Position is clamped against the measured menu
 * size, flipping to the other side of the anchor when there is no room.
 */
export function FloatingChangeMenu({
	x,
	y,
	target,
	handlers,
	onClose,
}: {
	x: number;
	y: number;
	target: ChangeMenuTarget;
	handlers: ChangeMenuHandlers;
	onClose: () => void;
}): JSX.Element {
	const ref = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

	// Measure before paint so the menu never flashes at the unclamped spot.
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const { width, height } = el.getBoundingClientRect();
		const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
		const maxTop = window.innerHeight - height - VIEWPORT_MARGIN;
		setPosition({
			// Flip to the left of the cursor rather than merely sliding inward, so the
			// menu never covers the row that was right-clicked.
			left: Math.max(VIEWPORT_MARGIN, x > maxLeft ? Math.min(x - width, maxLeft) : x),
			top: Math.max(VIEWPORT_MARGIN, Math.min(y, maxTop)),
		});
	}, [x, y]);

	useEffect(() => {
		const onPointerDown = (event: PointerEvent): void => {
			if (!ref.current?.contains(event.target as Node)) onClose();
		};
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === "Escape") onClose();
		};
		// Capture phase: the menu must close even when the click lands on a row that
		// stops propagation on its own.
		window.addEventListener("pointerdown", onPointerDown, true);
		window.addEventListener("keydown", onKeyDown, true);
		window.addEventListener("scroll", onClose, true);
		window.addEventListener("resize", onClose);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown, true);
			window.removeEventListener("keydown", onKeyDown, true);
			window.removeEventListener("scroll", onClose, true);
			window.removeEventListener("resize", onClose);
		};
	}, [onClose]);

	return createPortal(
		<div
			ref={ref}
			data-vetta-plugin-root="git"
			// Marks this as part of the tree's own menu surface, so the library does not
			// treat clicks inside it as an outside click.
			data-file-tree-context-menu-root="true"
			className="fixed z-50"
			style={{ left: position?.left ?? x, top: position?.top ?? y, visibility: position ? "visible" : "hidden" }}
		>
			<ChangeMenuItems target={target} handlers={handlers} onDone={onClose} />
		</div>,
		document.body,
	);
}
