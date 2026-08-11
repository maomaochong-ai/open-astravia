import { useTranslation } from "@vetta-org/plugin-sdk";
import { type JSX, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { GalleryDesign } from "./gallery-model";
import type { GalleryCard } from "./gallery-store";

export interface CardMenuAnchor {
	card: GalleryCard;
	/** 画廊容器内坐标。 */
	x: number;
	y: number;
}

interface CardContextMenuProps {
	anchor: CardMenuAnchor;
	onExport(design: GalleryDesign): void;
	onReveal(): void;
	onArchive(): void;
	onClose(): void;
}

const EDGE_GAP = 8;

const icons = {
	export: (
		<svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	),
	reveal: (
		<svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" strokeLinejoin="round" />
		</svg>
	),
	archive: (
		<svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<rect x="3" y="4" width="18" height="4" rx="1" />
			<path d="M5 8v11a1 1 0 001 1h12a1 1 0 001-1V8M10 12h4" strokeLinecap="round" />
		</svg>
	),
};

function MenuItem({
	icon,
	label,
	danger,
	onClick,
}: {
	icon?: JSX.Element;
	label: string;
	danger?: boolean;
	onClick(): void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
				danger ? "text-red-500 hover:bg-red-500/10" : "text-foreground hover:bg-accent"
			}`}
		>
			{icon ?? <span className="size-3.5" />}
			<span className="truncate">{label}</span>
		</button>
	);
}

/**
 * 卡片右键菜单。
 *
 * 导出是**设计**级动作而卡片是**项目**级的：只有一份设计时直接导，多份时把歧义
 * 显式摊开给用户选，而不是替他挑一份。
 */
export function CardContextMenu({ anchor, onExport, onReveal, onArchive, onClose }: CardContextMenuProps) {
	const { t } = useTranslation();
	const ref = useRef<HTMLDivElement | null>(null);
	const [position, setPosition] = useState({ x: anchor.x, y: anchor.y });
	const designs = anchor.card.designs;

	useLayoutEffect(() => {
		const element = ref.current;
		const parent = element?.offsetParent as HTMLElement | null;
		if (!element || !parent) return;
		setPosition({
			x: Math.max(EDGE_GAP, Math.min(anchor.x, parent.clientWidth - element.offsetWidth - EDGE_GAP)),
			y: Math.max(EDGE_GAP, Math.min(anchor.y, parent.clientHeight - element.offsetHeight - EDGE_GAP)),
		});
	}, [anchor.x, anchor.y]);

	useEffect(() => {
		const onPointerDown = (event: PointerEvent): void => {
			if (ref.current?.contains(event.target as Node)) return;
			onClose();
		};
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key !== "Escape") return;
			event.stopPropagation();
			onClose();
		};
		window.addEventListener("pointerdown", onPointerDown, true);
		window.addEventListener("keydown", onKeyDown, true);
		window.addEventListener("wheel", onClose, true);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown, true);
			window.removeEventListener("keydown", onKeyDown, true);
			window.removeEventListener("wheel", onClose, true);
		};
	}, [onClose]);

	return (
		<div
			ref={ref}
			className="absolute z-40 min-w-44 rounded-xl border border-border bg-card p-1 shadow-xl"
			style={{ left: position.x, top: position.y }}
			onContextMenu={(event) => event.preventDefault()}
		>
			{designs.length === 1 ? (
				<MenuItem icon={icons.export} label={t("gallery.menu.export")} onClick={() => onExport(designs[0])} />
			) : (
				<>
					<p className="px-2 py-1 text-[11px] text-muted-foreground">{t("gallery.menu.exportWhich")}</p>
					{designs.map((design) => (
						<MenuItem key={design.vetdPath} label={design.name} onClick={() => onExport(design)} />
					))}
				</>
			)}
			<div className="my-1 h-px bg-border" />
			<MenuItem icon={icons.reveal} label={t("gallery.menu.reveal")} onClick={onReveal} />
			<MenuItem icon={icons.archive} label={t("gallery.menu.archive")} danger onClick={onArchive} />
		</div>
	);
}
