/** Stable public asset paths safe to persist in Agent profiles across builds. */
export const AGENT_AVATAR_OPTIONS = Object.freeze(
	Array.from({ length: 9 }, (_, index) => `./agent-team-avatars/avatar-${String(index + 1).padStart(2, "0")}.webp`),
);

const BLUEPRINT_AVATAR_INDEX: Readonly<Record<string, number>> = Object.freeze({
	leader: 0,
	researcher: 1,
	builder: 2,
	reviewer: 3,
});

/** Returns a stable built-in avatar for profiles that have no custom selection. */
export function agentAvatarUrl(profile: {
	readonly id: string;
	readonly blueprintId: string;
	readonly avatar?: string;
}): string {
	if (profile.avatar) return profile.avatar;
	const blueprintIndex = BLUEPRINT_AVATAR_INDEX[profile.blueprintId];
	const index = blueprintIndex ?? stableIndex(profile.id);
	return AGENT_AVATAR_OPTIONS[index % AGENT_AVATAR_OPTIONS.length]!;
}

function stableIndex(value: string): number {
	let hash = 0;
	for (const character of value) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
	return hash % AGENT_AVATAR_OPTIONS.length;
}
