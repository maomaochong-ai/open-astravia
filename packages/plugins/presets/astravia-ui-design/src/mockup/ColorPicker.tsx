import { useTranslation } from "@astravia-org/plugin-sdk";
import { type JSX, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PluginPortal } from "../plugin-portal";
import { hexToHsv, hsvToHex, toHex } from "./color";

interface ColorPickerProps {
	label: string;
	color: string;
	/** Swatches pulled from the design's own theme.css tokens. */
	palette: string[];
	disabled?: boolean;
	onPick(next: string): void;
}

const POPOVER_WIDTH = 232;
const POPOVER_HEIGHT = 300;

/** Saturation/value square: x is saturation, y is inverted value. */
function ShadeArea({ hue, s, v, onChange }: { hue: number; s: number; v: number; onChange(s: number, v: number): void }) {
	const draggingRef = useRef(false);

	const update = (element: HTMLDivElement, clientX: number, clientY: number): void => {
		const rect = element.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return;
		onChange(
			Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
			1 - Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
		);
	};

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: pointer-driven surface; the hex field is the accessible path
		<div
			className="relative h-32 w-full cursor-crosshair touch-none overflow-hidden rounded-lg border border-border"
			style={{
				backgroundColor: hsvToHex({ h: hue, s: 1, v: 1 }),
				backgroundImage:
					"linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)",
			}}
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				event.preventDefault();
				draggingRef.current = true;
				event.currentTarget.setPointerCapture(event.pointerId);
				update(event.currentTarget, event.clientX, event.clientY);
			}}
			onPointerMove={(event) => {
				if (!draggingRef.current) return;
				update(event.currentTarget, event.clientX, event.clientY);
			}}
			onPointerUp={(event) => {
				draggingRef.current = false;
				event.currentTarget.releasePointerCapture(event.pointerId);
			}}
			onPointerCancel={() => {
				draggingRef.current = false;
			}}
		>
			<span
				className="pointer-events-none absolute size-3.5 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
				style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, transform: "translate(-50%, -50%)" }}
			/>
		</div>
	);
}

/** Hue rail, drawn as its own strip so the shade area stays a pure square. */
function HueRail({ hue, onChange }: { hue: number; onChange(next: number): void }) {
	const draggingRef = useRef(false);

	const update = (element: HTMLDivElement, clientX: number): void => {
		const rect = element.getBoundingClientRect();
		if (rect.width <= 0) return;
		onChange(Math.min(360, Math.max(0, ((clientX - rect.left) / rect.width) * 360)));
	};

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: pointer-driven surface; the hex field is the accessible path
		<div
			className="relative h-3 w-full cursor-pointer touch-none rounded-full"
			style={{
				backgroundImage:
					"linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
			}}
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				event.preventDefault();
				draggingRef.current = true;
				event.currentTarget.setPointerCapture(event.pointerId);
				update(event.currentTarget, event.clientX);
			}}
			onPointerMove={(event) => {
				if (!draggingRef.current) return;
				update(event.currentTarget, event.clientX);
			}}
			onPointerUp={(event) => {
				draggingRef.current = false;
				event.currentTarget.releasePointerCapture(event.pointerId);
			}}
			onPointerCancel={() => {
				draggingRef.current = false;
			}}
		>
			<span
				className="pointer-events-none absolute top-1/2 size-4 rounded-full border-2 border-white bg-transparent shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
				style={{ left: `${(hue / 360) * 100}%`, transform: "translate(-50%, -50%)" }}
			/>
		</div>
	);
}

/**
 * Swatch trigger plus a floating HSV picker. The panel is `fixed` rather than
 * absolute because the options column scrolls and clips its own overflow.
 */
export function ColorPicker({ label, color, palette, disabled, onPick }: ColorPickerProps): JSX.Element {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState("");
	const [anchor, setAnchor] = useState({ left: 0, top: 0 });
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);

	const hex = toHex(color);
	const hsv = hexToHsv(hex);
	// Hue and saturation are undefined for black/white; keep the last usable one
	// so dragging value up out of black does not snap back to red.
	const hueRef = useRef(hsv.h);
	if (hsv.s > 0 && hsv.v > 0) hueRef.current = hsv.h;
	const hue = hueRef.current;

	useLayoutEffect(() => {
		if (!open) return;
		const rect = triggerRef.current?.getBoundingClientRect();
		if (!rect) return;
		const left = Math.max(8, Math.min(rect.right - POPOVER_WIDTH, window.innerWidth - POPOVER_WIDTH - 8));
		const below = rect.bottom + 6;
		const top = below + POPOVER_HEIGHT > window.innerHeight - 8 ? Math.max(8, rect.top - POPOVER_HEIGHT - 6) : below;
		setAnchor({ left, top });
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent): void => {
			const target = event.target as Node;
			if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
			setOpen(false);
		};
		// Capture phase: the export dialog closes itself on Escape, and the picker
		// has to win that key first.
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key !== "Escape") return;
			event.stopPropagation();
			setOpen(false);
		};
		window.addEventListener("pointerdown", onPointerDown, true);
		window.addEventListener("keydown", onKeyDown, true);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown, true);
			window.removeEventListener("keydown", onKeyDown, true);
		};
	}, [open]);

	useEffect(() => {
		if (open) setDraft(hex.slice(1).toUpperCase());
	}, [open, hex]);

	/**
	 * 主题色板按最终色值去重。theme.css 里多个 token 指向同一个颜色是常态
	 * （--border 与 --input 都是那一档灰），照单全收就是一排看不出区别的重复
	 * 色块，而且 React 会因为重复 key 报警。
	 */
	const swatches = useMemo(() => {
		const seen = new Set<string>();
		return palette.filter((value) => {
			const key = toHex(value).toLowerCase();
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}, [palette]);

	const commitDraft = (value: string): void => {
		const cleaned = value.replace(/[^0-9a-f]/gi, "").slice(0, 6);
		setDraft(cleaned.toUpperCase());
		if (cleaned.length === 6) onPick(`#${cleaned.toLowerCase()}`);
	};

	return (
		<div className={`flex flex-col gap-1.5 ${disabled ? "pointer-events-none opacity-40" : ""}`}>
			<span className="text-xs text-muted-foreground">{label}</span>
			<button
				ref={triggerRef}
				type="button"
				disabled={disabled}
				onClick={() => setOpen((current) => !current)}
				aria-expanded={open}
				className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors hover:bg-accent ${
					open ? "border-primary" : "border-border"
				}`}
			>
				<span
					className="size-5 shrink-0 rounded-md border border-border"
					style={{ backgroundColor: hex }}
					aria-hidden="true"
				/>
				<span className="flex-1 text-xs font-medium uppercase tabular-nums text-foreground">{hex}</span>
			</button>

			{/*
			  弹出面板 portal 到 body。它是 `fixed` 定位，而它的祖先——工作台右上角那张
			  悬浮选项卡——带 backdrop-filter：按 CSS 规范，带 filter/backdrop-filter 的
			  元素会成为 fixed 后代的包含块，于是这套按视口算出来的 left/top 变成相对卡片，
			  面板被推到卡片外面（卡片长出横向滚动条，色板根本看不见）。
			  PluginPortal 负责重新进入插件 CSS 的 @scope。
			*/}
			{open ? (
				<PluginPortal>
					<div
						ref={panelRef}
						className="fixed z-[1010] flex flex-col gap-3 rounded-xl border border-border bg-card p-3 shadow-2xl"
						style={{ left: anchor.left, top: anchor.top, width: POPOVER_WIDTH }}
					>
						<ShadeArea
							hue={hue}
							s={hsv.s}
							v={hsv.v}
							onChange={(s, v) => onPick(hsvToHex({ h: hue, s, v }))}
						/>
						<HueRail hue={hue} onChange={(next) => onPick(hsvToHex({ h: next, s: hsv.s, v: hsv.v || 1 }))} />

						<label className="flex items-center gap-2 rounded-lg border border-border px-2 py-1">
							<span className="text-xs text-muted-foreground">#</span>
							<input
								value={draft}
								spellCheck={false}
								aria-label={t("mockup.color.hex")}
								onChange={(event) => commitDraft(event.target.value)}
								className="w-full bg-transparent text-xs font-medium uppercase tabular-nums text-foreground outline-none"
							/>
						</label>

						{swatches.length > 0 ? (
							<div className="flex flex-col gap-1.5">
								<span className="text-[11px] text-muted-foreground">{t("mockup.color.theme")}</span>
								<div className="flex flex-wrap gap-1.5">
									{swatches.map((swatch) => {
										const swatchHex = toHex(swatch);
										return (
											<button
												key={swatch}
												type="button"
												title={swatch}
												onClick={() => onPick(swatchHex)}
												style={{ background: swatch }}
												className={`size-5 rounded-md border ${
													swatchHex === hex ? "border-primary ring-1 ring-primary" : "border-border"
												}`}
											/>
										);
									})}
								</div>
							</div>
						) : null}
					</div>
				</PluginPortal>
			) : null}
		</div>
	);
}
