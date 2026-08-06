/**
 * Whether dropping a connection should open the "create compatible node" menu.
 *
 * - Valid completed connections are handled by `onConnect` only.
 * - Dropping on a *different* node (even if invalid) should not open the menu.
 * - Dropping on empty pane, or releasing over the same source node (large
 *   bookmark ports often hit themselves), should open the menu.
 */
export function shouldOpenConnectionCreateMenu(state: {
	isValid: boolean | null | undefined;
	fromNodeId?: string | null;
	toNodeId?: string | null;
	hasFromHandle: boolean;
}): boolean {
	if (!state.fromNodeId || !state.hasFromHandle) return false;
	if (state.isValid) return false;
	if (state.toNodeId && state.toNodeId !== state.fromNodeId) return false;
	return true;
}
