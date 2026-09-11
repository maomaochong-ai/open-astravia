/**
 * Per-runtime activity (todo / background tasks / subagents) is stored keyed by runtime id.
 * A workspace can aggregate several runtimes (a Team's coordination + member runtimes), so
 * readers flatten those maps while keeping each row's owning runtime for actions that must
 * be routed back to it (stop / interrupt / clear).
 */
export interface RuntimeScoped<T> {
	readonly runtimeId: string;
	readonly item: T;
}

export function collectRuntimeScoped<T>(
	runtimeIds: readonly string[],
	read: (runtimeId: string) => readonly T[],
): RuntimeScoped<T>[] {
	const rows: RuntimeScoped<T>[] = [];
	for (const runtimeId of runtimeIds) {
		for (const item of read(runtimeId)) rows.push({ runtimeId, item });
	}
	return rows;
}

export function collectRuntimeItems<T>(runtimeIds: readonly string[], read: (runtimeId: string) => readonly T[]): T[] {
	return collectRuntimeScoped(runtimeIds, read).map((row) => row.item);
}
