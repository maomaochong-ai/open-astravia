import { useCallback, useEffect, useRef, useState } from "react";
import type { McpAbility } from "../types";

export type McpSetupStatusPhase = "checking" | "authenticated" | "unauthenticated" | "failed";

export interface McpSetupStatusModel {
	readonly phase: McpSetupStatusPhase;
	readonly username?: string;
	readonly error?: string;
	readonly checkedAt?: number;
	readonly retry: () => void;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Detail connector for the upstream login-status endpoint. */
export function useMcpSetupStatusModel(
	item: McpAbility,
	onStatusChanged: () => void,
	refreshKey?: string | null,
): McpSetupStatusModel | undefined {
	const enabled = item.installed && Boolean(item.postInstallSetup);
	const [phase, setPhase] = useState<McpSetupStatusPhase>("checking");
	const [username, setUsername] = useState<string | undefined>();
	const [error, setError] = useState<string | undefined>();
	const [checkedAt, setCheckedAt] = useState<number | undefined>();
	const runRef = useRef(0);
	const onStatusChangedRef = useRef(onStatusChanged);
	onStatusChangedRef.current = onStatusChanged;

	const check = useCallback(() => {
		if (!enabled) return;
		const run = ++runRef.current;
		setPhase("checking");
		setError(undefined);
		void window.vetta.mcp
			.getSetupLoginStatus(item.serverName)
			.then((status) => {
				if (run !== runRef.current) return;
				setUsername(status.username);
				setPhase(status.state);
				setCheckedAt(Date.now());
				onStatusChangedRef.current();
			})
			.catch((reason: unknown) => {
				if (run !== runRef.current) return;
				setError(errorMessage(reason));
				setPhase("failed");
			});
	}, [enabled, item.serverName]);

	useEffect(() => {
		const initialCheck = refreshKey ? undefined : setTimeout(check, 0);
		return () => {
			if (initialCheck !== undefined) clearTimeout(initialCheck);
			runRef.current += 1;
		};
	}, [check, refreshKey]);

	return enabled ? { phase, username, error, checkedAt, retry: check } : undefined;
}
