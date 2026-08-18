/**
 * Activate input actions without invalidating atom consumers when every action
 * is already active. The returned Set is mutable only for compatibility with
 * the existing atom contract; callers should treat it as immutable.
 */
export function activateInputActionIds(current: Set<string>, actionIds: readonly string[]): Set<string> {
	let next: Set<string> | undefined;
	for (const actionId of actionIds) {
		if (current.has(actionId)) continue;
		next ??= new Set(current);
		next.add(actionId);
	}
	return next ?? current;
}
