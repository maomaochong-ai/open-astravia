import { useTranslation } from "@vetta-org/plugin-sdk";
import { useEffect, useRef } from "react";
import { CONTENT_NODE_DEFINITIONS } from "../node/definitions";
import type { ContentNodeKind } from "../project/types";
import { NodeDefinitionGrid } from "./NodeLibrary";

interface ConnectionCreateMenuProps {
	left: number;
	top: number;
	kinds: readonly ContentNodeKind[];
	onSelect: (kind: ContentNodeKind) => void;
	onClose?: () => void;
}

export function ConnectionCreateMenu({ left, top, kinds, onSelect, onClose }: ConnectionCreateMenuProps) {
	const { t } = useTranslation();
	const rootRef = useRef<HTMLDivElement>(null);
	const definitions = CONTENT_NODE_DEFINITIONS.filter((definition) => kinds.includes(definition.kind));

	useEffect(() => {
		if (!onClose) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		const onPointerDown = (event: PointerEvent) => {
			if (event.target instanceof globalThis.Node && rootRef.current?.contains(event.target)) return;
			onClose();
		};
		// Defer outside-close so the mouseup/click that opened the menu does not immediately dismiss it.
		const timer = window.setTimeout(() => {
			document.addEventListener("pointerdown", onPointerDown, true);
			document.addEventListener("keydown", onKeyDown, true);
		}, 0);
		return () => {
			window.clearTimeout(timer);
			document.removeEventListener("pointerdown", onPointerDown, true);
			document.removeEventListener("keydown", onKeyDown, true);
		};
	}, [onClose]);

	return (
		<div
			ref={rootRef}
			className="absolute z-30 w-[min(320px,calc(100vw_-_48px))] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg nodrag nowheel"
			style={{ left, top }}
			onPointerDown={(event) => event.stopPropagation()}
		>
			<strong className="block text-[13px] font-medium">{t("connectionMenu.title")}</strong>
			<p className="m-0 mt-0.5 text-[11px] text-muted-foreground">{t("connectionMenu.description")}</p>
			{definitions.length === 0 ? (
				<p className="mb-0 mt-3 text-[12px] text-muted-foreground">{t("nodeLibrary.empty")}</p>
			) : (
				<NodeDefinitionGrid definitions={definitions} onSelect={onSelect} compact />
			)}
		</div>
	);
}
