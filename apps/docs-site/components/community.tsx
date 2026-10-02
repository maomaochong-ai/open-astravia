import { site } from "@/lib/site";
import type { ReactNode } from "react";

/**
 * Single exit point for the community invite. The address lives in `lib/site.ts`
 * so swapping servers never leaves a stale copy inside the content.
 */
export function CommunityInvite({ children }: { children: ReactNode }) {
	return (
		<a href={site.communityUrl} target="_blank" rel="noreferrer">
			{children}
		</a>
	);
}

/** Wordless community mark. Sized by the caller so it matches whatever row it sits in. */
export function CommunityGlyph() {
	return (
		<svg role="img" viewBox="0 0 24 24" fill="currentColor">
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M4.5 3.5H19.5A2.5 2.5 0 0 1 22 6V15A2.5 2.5 0 0 1 19.5 17.5H12.4L7.8 21.6L8.8 17.5H4.5A2.5 2.5 0 0 1 2 15V6A2.5 2.5 0 0 1 4.5 3.5ZM7.6 9.6a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 1 0 0-2.6Zm4.4 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 1 0 0-2.6Zm4.4 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 1 0 0-2.6Z"
			/>
		</svg>
	);
}
