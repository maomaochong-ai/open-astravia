/**
 * Settings AI-assist → sidebar session cue (GSAP).
 *
 * Flow: pop at click ∥ resolve target → one quadratic parabola → land bloom.
 * Visual: layered core + halo + ring, light trail along the arc.
 */

import gsap from "gsap";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";

gsap.registerPlugin(MotionPathPlugin);

const TARGET_WAIT_MS = 200;
const WAIT_INTERVAL_MS = 32;
const ORB_SIZE_PX = 11;
const POP_DURATION = 0.14;
/** Rise of the parabola above the start→end chord (screen px). */
const ARC_PEAK_MIN_PX = 72;
const ARC_PEAK_MAX_PX = 148;
const ARC_PEAK_DIST_FACTOR = 0.2;
/** Drop a trail mote every N path-progress units (0–1). */
const TRAIL_STEP = 0.08;

function prefersReducedMotion(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function rectCenter(rect: DOMRect): { x: number; y: number } {
	return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function querySessionRow(sessionPath?: string): HTMLElement | null {
	if (sessionPath) {
		const escaped = typeof CSS !== "undefined" && "escape" in CSS ? CSS.escape(sessionPath) : sessionPath;
		const byPath = document.querySelector<HTMLElement>(`[data-session-path="${escaped}"]`);
		if (byPath) return byPath;
	}
	return document.querySelector<HTMLElement>('[data-session-active="true"]');
}

function querySidebarFallbackRect(): DOMRect | null {
	const scroll =
		document.querySelector<HTMLElement>('[data-sidebar-selection-scroll="true"]') ??
		document.querySelector<HTMLElement>("[data-sidebar-projects]") ??
		null;
	if (!scroll) return null;
	const r = scroll.getBoundingClientRect();
	if (r.width <= 0 || r.height <= 0) return null;
	const w = Math.min(48, r.width * 0.55);
	const h = 28;
	return new DOMRect(r.left + r.width * 0.42 - w / 2, r.top + Math.min(56, r.height * 0.12), w, h);
}

function scrollRowIntoView(row: HTMLElement): void {
	const scrollParent = row.closest<HTMLElement>('[data-sidebar-selection-scroll="true"]');
	if (!scrollParent) {
		row.scrollIntoView({ block: "nearest", inline: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
		return;
	}
	const parentRect = scrollParent.getBoundingClientRect();
	const rowRect = row.getBoundingClientRect();
	const pad = 24;
	if (rowRect.top >= parentRect.top + pad && rowRect.bottom <= parentRect.bottom - pad) return;
	const delta = rowRect.top - parentRect.top - parentRect.height * 0.33;
	scrollParent.scrollTo({
		top: Math.max(0, scrollParent.scrollTop + delta),
		behavior: prefersReducedMotion() ? "auto" : "smooth",
	});
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function waitForSidebarSessionRow(
	getSessionPath?: () => string | undefined,
	timeoutMs = TARGET_WAIT_MS,
	signal?: AbortSignal,
): Promise<HTMLElement | null> {
	const deadline = performance.now() + timeoutMs;
	while (performance.now() < deadline) {
		if (signal?.aborted) return null;
		const row = querySessionRow(getSessionPath?.());
		if (row) return row;
		await wait(WAIT_INTERVAL_MS);
	}
	return querySessionRow(getSessionPath?.());
}

export function readAiAssistOriginRect(): DOMRect | null {
	const submit = document.querySelector<HTMLElement>("[data-settings-ai-assist-submit]");
	if (submit) {
		const rect = submit.getBoundingClientRect();
		if (rect.width > 0 && rect.height > 0) return rect;
	}
	const trigger = document.querySelector<HTMLElement>("[data-settings-ai-assist-trigger]");
	if (trigger) {
		const rect = trigger.getBoundingClientRect();
		if (rect.width > 0 && rect.height > 0) return rect;
	}
	return null;
}

interface OrbBundle {
	root: HTMLElement;
	halo: HTMLElement;
	ring: HTMLElement;
	core: HTMLElement;
	spark: HTMLElement;
}

function createOrbBundle(from: DOMRect): OrbBundle {
	const fromC = rectCenter(from);
	const root = document.createElement("div");
	root.setAttribute("aria-hidden", "true");
	root.setAttribute("data-settings-ai-assist-orb", "");
	root.style.cssText = [
		"position:fixed",
		"z-index:2147483000",
		`left:${fromC.x - ORB_SIZE_PX / 2}px`,
		`top:${fromC.y - ORB_SIZE_PX / 2}px`,
		`width:${ORB_SIZE_PX}px`,
		`height:${ORB_SIZE_PX}px`,
		"pointer-events:none",
		"will-change:transform,opacity",
	].join(";");

	const halo = document.createElement("div");
	halo.style.cssText = [
		"position:absolute",
		// Tight glow — previous -140% read as a large soft blob around the orb.
		"inset:-55%",
		"border-radius:9999px",
		"background:radial-gradient(circle, color-mix(in srgb, var(--primary) 45%, transparent) 0%, transparent 72%)",
		"filter:blur(1px)",
		"opacity:0.65",
	].join(";");

	const ring = document.createElement("div");
	ring.style.cssText = [
		"position:absolute",
		"inset:-18%",
		"border-radius:9999px",
		"border:1px solid color-mix(in srgb, var(--primary) 55%, white)",
		"box-shadow:0 0 6px color-mix(in srgb, var(--primary) 30%, transparent)",
		"opacity:0.7",
	].join(";");

	const core = document.createElement("div");
	core.style.cssText = [
		"position:absolute",
		"inset:0",
		"border-radius:9999px",
		"background:radial-gradient(circle at 32% 28%, #fff 0%, color-mix(in srgb, var(--primary) 70%, white) 40%, var(--primary) 78%)",
		"box-shadow:0 0 6px color-mix(in srgb, var(--primary) 65%, transparent), inset 0 0 3px color-mix(in srgb, #fff 45%, transparent)",
	].join(";");

	const spark = document.createElement("div");
	spark.style.cssText = [
		"position:absolute",
		"left:24%",
		"top:20%",
		"width:28%",
		"height:24%",
		"border-radius:9999px",
		"background:radial-gradient(circle, rgba(255,255,255,0.9) 0%, transparent 70%)",
		"opacity:0.85",
		"pointer-events:none",
	].join(";");

	core.appendChild(spark);
	root.append(halo, ring, core);
	document.body.appendChild(root);
	gsap.set(root, { x: 0, y: 0, scale: 0.2, opacity: 0, transformOrigin: "50% 50%" });
	gsap.set(halo, { scale: 0.6, opacity: 0 });
	gsap.set(ring, { scale: 0.4, opacity: 0 });
	return { root, halo, ring, core, spark };
}

function spawnTrailMote(x: number, y: number, size: number): void {
	const mote = document.createElement("div");
	mote.setAttribute("aria-hidden", "true");
	mote.style.cssText = [
		"position:fixed",
		"z-index:2147482999",
		`left:${x - size / 2}px`,
		`top:${y - size / 2}px`,
		`width:${size}px`,
		`height:${size}px`,
		"border-radius:9999px",
		"pointer-events:none",
		"background:radial-gradient(circle, color-mix(in srgb, var(--primary) 80%, white) 0%, transparent 70%)",
		"opacity:0.55",
	].join(";");
	document.body.appendChild(mote);
	gsap.fromTo(
		mote,
		{ scale: 1, opacity: 0.55 },
		{
			scale: 0.2,
			opacity: 0,
			duration: 0.28,
			ease: "power2.out",
			onComplete: () => mote.remove(),
		},
	);
}

function spawnLandingBurst(x: number, y: number): void {
	const burst = document.createElement("div");
	burst.setAttribute("aria-hidden", "true");
	burst.style.cssText = [
		"position:fixed",
		"z-index:2147482998",
		`left:${x - 6}px`,
		`top:${y - 6}px`,
		"width:12px",
		"height:12px",
		"border-radius:9999px",
		"pointer-events:none",
		"border:1.5px solid color-mix(in srgb, var(--primary) 65%, white)",
		"box-shadow:0 0 8px color-mix(in srgb, var(--primary) 40%, transparent)",
	].join(";");
	document.body.appendChild(burst);
	gsap.fromTo(
		burst,
		{ scale: 0.5, opacity: 0.75 },
		{
			scale: 1.8,
			opacity: 0,
			duration: 0.32,
			ease: "power2.out",
			onComplete: () => burst.remove(),
		},
	);
}

function resolveTargetRect(row: HTMLElement | null): DOMRect | null {
	if (row) {
		scrollRowIntoView(row);
		const r = row.getBoundingClientRect();
		if (r.width > 0 && r.height > 0) return r;
	}
	return querySidebarFallbackRect();
}

/**
 * Single quadratic parabola: start → control (mid chord + peak up) → end.
 * Screen y grows downward, so peak is subtracted.
 */
function buildParabolaPath(dx: number, dy: number): string {
	const dist = Math.hypot(dx, dy);
	let peak = Math.min(ARC_PEAK_MAX_PX, Math.max(ARC_PEAK_MIN_PX, dist * ARC_PEAK_DIST_FACTOR));
	const alreadyUp = Math.max(0, -dy);
	peak = Math.max(ARC_PEAK_MIN_PX * 0.7, peak - alreadyUp * 0.18);

	const cpx = dx * 0.5;
	const cpy = dy * 0.5 - peak;
	return `M0,0 Q${cpx},${cpy} ${dx},${dy}`;
}

function flightDurationSec(dist: number): number {
	return Math.min(0.62, Math.max(0.38, dist / 1100));
}

function tweenPromise(tween: gsap.core.Tween | gsap.core.Timeline, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal?.aborted) {
			tween.kill();
			resolve();
			return;
		}
		const onAbort = (): void => {
			tween.kill();
			resolve();
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		tween.eventCallback("onComplete", () => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		});
		tween.eventCallback("onInterrupt", () => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		});
	});
}

export interface FlyToSidebarSessionOptions {
	sessionPath?: string;
	getSessionPath?: () => string | undefined;
	signal?: AbortSignal;
	onFlyStart?: () => void;
}

/** Mount orb at `origin`, then fly a single parabolic arc to the sidebar. */
export async function flyToSidebarSession(origin: DOMRect | null, options?: FlyToSidebarSessionOptions): Promise<void> {
	if (prefersReducedMotion() || !origin) return;
	if (options?.signal?.aborted) return;

	const orb = createOrbBundle(origin);
	const { root, halo, ring, core, spark } = orb;
	const getPath = (): string | undefined => options?.sessionPath || options?.getSessionPath?.();
	const signal = options?.signal;

	const cleanup = (): void => {
		gsap.killTweensOf([root, halo, ring, core, spark]);
		root.remove();
	};

	const onAbort = (): void => {
		cleanup();
	};
	signal?.addEventListener("abort", onAbort, { once: true });

	try {
		// Pop-in: compact appear without a large bloom.
		const pop = gsap.timeline();
		pop.fromTo(
			root,
			{ opacity: 0, scale: 0.35 },
			{ opacity: 1, scale: 1.04, duration: POP_DURATION, ease: "back.out(1.8)" },
			0,
		);
		pop.fromTo(
			halo,
			{ scale: 0.6, opacity: 0 },
			{ scale: 1, opacity: 0.65, duration: POP_DURATION, ease: "power2.out" },
			0,
		);
		pop.fromTo(
			ring,
			{ scale: 0.5, opacity: 0 },
			{ scale: 1, opacity: 0.7, duration: POP_DURATION, ease: "power2.out" },
			0,
		);
		pop.to(root, { scale: 1, duration: 0.06, ease: "power2.out" }, ">-0.04");

		const rowPromise = waitForSidebarSessionRow(getPath, TARGET_WAIT_MS, signal);
		await Promise.all([tweenPromise(pop, signal), rowPromise.then(() => undefined)]);
		if (signal?.aborted) return;

		const row = querySessionRow(getPath()) ?? (await rowPromise);
		const target = resolveTargetRect(row);
		if (!target) {
			cleanup();
			return;
		}

		const fromC = rectCenter(origin);
		const toC = rectCenter(target);
		const dx = toC.x - fromC.x;
		const dy = toC.y - fromC.y;
		const dist = Math.hypot(dx, dy);
		const flySec = flightDurationSec(dist);
		const path = buildParabolaPath(dx, dy);

		options?.onFlyStart?.();

		// Soft pulse — keep amplitude small so the halo stays tight.
		const pulse = gsap.timeline({ repeat: -1 });
		pulse.to(halo, { scale: 1.08, opacity: 0.5, duration: 0.32, ease: "sine.inOut" });
		pulse.to(halo, { scale: 1, opacity: 0.65, duration: 0.32, ease: "sine.inOut" });
		gsap.to(spark, {
			opacity: 0.5,
			duration: 0.28,
			yoyo: true,
			repeat: -1,
			ease: "sine.inOut",
		});

		let trailProgress = 0;
		const fly = gsap.timeline({
			onComplete: () => {
				pulse.kill();
				gsap.killTweensOf(spark);
			},
		});

		// Single parabola; sparse small trail motes.
		fly.to(
			root,
			{
				duration: flySec,
				ease: "none",
				motionPath: {
					path,
					autoRotate: false,
					alignOrigin: [0.5, 0.5],
				},
				onUpdate: function onFlyUpdate() {
					const p = this.progress();
					if (p - trailProgress < TRAIL_STEP) return;
					trailProgress = p;
					const rect = root.getBoundingClientRect();
					const size = 2.5 + (1 - p) * 2;
					spawnTrailMote(rect.left + rect.width / 2, rect.top + rect.height / 2, size);
				},
			},
			0,
		);

		// Compact land.
		fly.to(root, { scale: 0.65, duration: flySec * 0.18, ease: "power2.in" }, flySec * 0.82);
		fly.to(root, { opacity: 0, scale: 0.25, duration: flySec * 0.12, ease: "power2.in" }, flySec * 0.9);
		fly.to(halo, { scale: 1.15, opacity: 0, duration: flySec * 0.14, ease: "power2.out" }, flySec * 0.86);

		await tweenPromise(fly, signal);

		if (!signal?.aborted) {
			const end = root.getBoundingClientRect();
			// Root may already be opacity 0; still use last layout box for burst center.
			const bx = end.left + end.width / 2 || toC.x;
			const by = end.top + end.height / 2 || toC.y;
			spawnLandingBurst(bx, by);
			// Tiny settle delay so burst is visible after root is cleaned up.
			await wait(40);
		}
	} finally {
		signal?.removeEventListener("abort", onAbort);
		cleanup();
	}
}
