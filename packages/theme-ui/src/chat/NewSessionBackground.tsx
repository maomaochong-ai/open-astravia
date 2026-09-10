import type { JSX } from "react";

/**
 * Fade applied to every new session page texture: densest at the optical centre,
 * spreading outward and fully transparent before the page edges.
 *
 * Exported because each texture must use this exact fade — a texture that is
 * still visible at the container edge gets sliced off by it, which reads as a
 * hard seam under the header. The vertical radius (45%) is what keeps the
 * pattern from reaching the top and bottom edges at all.
 */
export const NEW_SESSION_TEXTURE_MASK =
	"radial-gradient(ellipse 70% 45% at 50% 45%, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.55) 55%, transparent 100%)";

/**
 * Ambient glow behind the new session page. Exported on its own because a host
 * may swap the texture layer while keeping this one: the glow is the page's
 * accent atmosphere, not part of any single texture's pattern.
 */
export function NewSessionAmbientGlow(): JSX.Element {
	return (
		<div className="pointer-events-none absolute inset-0">
			<div
				className="absolute left-1/2 top-[30%] h-[440px] w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.1]"
				style={{
					background: "radial-gradient(circle, var(--primary) 0%, transparent 70%)",
				}}
			/>
		</div>
	);
}

/** Grid texture plus the ambient glow — the default backdrop. */
export function NewSessionBackground(): JSX.Element {
	return (
		<>
			{/* Primary grid texture, faded toward edges */}
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0"
				style={{
					backgroundImage:
						"linear-gradient(to right, color-mix(in srgb, var(--primary) 7%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--primary) 7%, transparent) 1px, transparent 1px)",
					backgroundSize: "32px 32px",
					backgroundPosition: "center center",
					maskImage: NEW_SESSION_TEXTURE_MASK,
					WebkitMaskImage: NEW_SESSION_TEXTURE_MASK,
				}}
			/>

			<NewSessionAmbientGlow />
		</>
	);
}
