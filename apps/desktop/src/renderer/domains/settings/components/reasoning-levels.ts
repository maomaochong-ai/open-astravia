/**
 * 推理档位列表的排序逻辑。档位只是按顺序排列的字符串（客户端按声明顺序展示、
 * 首个档位即默认档位的候选），因此拖拽直接用下标表达位置。
 */

/**
 * 把 `from` 处的档位移到「`insertBefore` 之前」。
 *
 * `insertBefore` 是**原数组**下标，取值域 `[0, length]`：等于 `length` 表示移到末尾；
 * 落在自己身上（`from` 或 `from + 1`）视为没拖，返回原数组，避免无意义的配置写回。
 */
export function moveReasoningLevel(levels: readonly string[], from: number, insertBefore: number): string[] {
	if (from < 0 || from >= levels.length) return [...levels];
	const target = Math.max(0, Math.min(insertBefore, levels.length));
	if (target === from || target === from + 1) return [...levels];

	const next = [...levels];
	const [moved] = next.splice(from, 1);
	next.splice(target > from ? target - 1 : target, 0, moved);
	return next;
}
