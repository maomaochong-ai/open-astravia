import { activeSessionAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useMemo } from "react";

/**
 * Runtime scope for hosts whose activity panel follows the globally active conversation
 * (ordinary chat, project detail, new session, session viewer). Team supplies its own
 * member runtimes instead and never reads the active session.
 */
export function useActiveSessionRuntimeIds(): readonly string[] {
	const activeSession = useAtomValue(activeSessionAtom);
	const runtimeId = activeSession?.runtimeId ?? null;
	return useMemo(() => (runtimeId ? [runtimeId] : []), [runtimeId]);
}
