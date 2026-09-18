import { startTransition, useEffect, useState } from "react";

/** Replay the original Hero entrance whenever the new-session project changes. */
export function useNewSessionHeroEntry(cwd: string): {
	readonly mounted: boolean;
	readonly avatarAutoplay: boolean;
} {
	const [mounted, setMounted] = useState(false);
	const [avatarAutoplay, setAvatarAutoplay] = useState(false);

	useEffect(() => {
		// Project identity only controls when the entrance replays.
		void cwd;
		setMounted(false);
		setAvatarAutoplay(false);
		const mountTimer = window.setTimeout(() => {
			startTransition(() => setMounted(true));
		}, 30);
		const autoplayTimer = window.setTimeout(() => {
			startTransition(() => setAvatarAutoplay(true));
		}, 300);
		return () => {
			window.clearTimeout(mountTimer);
			window.clearTimeout(autoplayTimer);
		};
	}, [cwd]);

	return { mounted, avatarAutoplay };
}
