import { useEffect, useState } from "react";

/**
 * Mac Dock 式放大参数，与 content-creation 画布 dock 保持同一手感：
 * 峰值克制，读得清又不会晃眼。
 */
export const DOCK_ICON = 34;
const DOCK_MAX_SCALE = 1.18;
const DOCK_INFLUENCE = 56;
export const DOCK_GAP = 6;

/** 余弦凸起：光标处最高，邻居平滑回落。 */
export function dockMagnifyScale(distancePx: number): number {
	if (distancePx >= DOCK_INFLUENCE) return 1;
	const t = distancePx / DOCK_INFLUENCE;
	return 1 + (DOCK_MAX_SCALE - 1) * Math.cos((t * Math.PI) / 2) ** 2;
}

export function dockTransition(reducedMotion: boolean): string {
	return reducedMotion
		? "transform 120ms ease"
		: "transform 140ms cubic-bezier(0.25, 0.8, 0.25, 1), background-color 120ms ease";
}

export function usePrefersReducedMotion(): boolean {
	const [reduced, setReduced] = useState(false);
	useEffect(() => {
		const media = window.matchMedia("(prefers-reduced-motion: reduce)");
		const sync = () => setReduced(media.matches);
		sync();
		media.addEventListener("change", sync);
		return () => media.removeEventListener("change", sync);
	}, []);
	return reduced;
}
