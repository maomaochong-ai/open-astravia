import { vi } from "vitest";

interface SessionApiMock {
	readonly subscribe: (sessionId: string, handler: (event: unknown) => void) => Promise<() => void>;
	readonly getFullHistory?: (sessionId: string) => Promise<unknown>;
}

/**
 * Give a mocked `window.vetta.session` the `attach` call built from its own
 * `getFullHistory` and `subscribe` mocks. Both are read at call time, so a test
 * that swaps `subscribe` later still captures the handler.
 */
export function withSessionAttach<T extends object>(api: T): T & { attach: ReturnType<typeof vi.fn> } {
	const source = api as unknown as SessionApiMock;
	return Object.assign(api, {
		attach: vi.fn(
			async (
				sessionId: string,
				handlers: { onSnapshot: (snapshot: { history: unknown }) => void; onEvent: (event: unknown) => void },
			) => {
				const history = source.getFullHistory ? await source.getFullHistory(sessionId) : [];
				handlers.onSnapshot({ history: history ?? [] });
				return source.subscribe(sessionId, handlers.onEvent);
			},
		),
	});
}
