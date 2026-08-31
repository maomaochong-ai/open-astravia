import type { RuntimeTraceRecord } from "@vetta/runtime-telemetry";

export function orderTraceRows(
	records: readonly RuntimeTraceRecord[],
): { record: RuntimeTraceRecord; depth: number }[] {
	const byId = new Map(records.map((record) => [record.id, record]));
	const children = new Map<string, RuntimeTraceRecord[]>();
	for (const record of records)
		if (record.parentSpanId && byId.has(record.parentSpanId)) {
			const items = children.get(record.parentSpanId) ?? [];
			items.push(record);
			children.set(record.parentSpanId, items);
		}
	const result: { record: RuntimeTraceRecord; depth: number }[] = [];
	const visited = new Set<string>();
	const append = (record: RuntimeTraceRecord, depth: number) => {
		if (visited.has(record.id)) return;
		visited.add(record.id);
		result.push({ record, depth });
		for (const child of (children.get(record.id) ?? []).sort((a, b) => a.startedAt - b.startedAt))
			append(child, Math.min(depth + 1, 8));
	};
	for (const record of [...records].sort((a, b) => b.startedAt - a.startedAt))
		if (!record.parentSpanId || !byId.has(record.parentSpanId)) append(record, 0);
	for (const record of records) append(record, 0);
	return result;
}
