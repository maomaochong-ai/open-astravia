/**
 * 把一串高频变更事件合并成「最少的重投影次数」。
 *
 * 用在会话文件订阅上：流式输出期间文件每几十毫秒被追写一次，而每次重投影都要把
 * 整份 JSONL 读入、解析、再投影成历史对象（4 MB 会话约 190 ms）。原样响应会把主线程
 * 占满，界面表现为卡顿；只做防抖又会丢掉「最后一次变更」，历史停在半截。
 *
 * 这里同时满足两条：窗口内的多次变更合并成一次（防抖 + 最小间隔），并且**最终一定会
 * 再发一次最新内容**——尾随那次不会被最小间隔吞掉，只会被推迟。
 */
export interface EmitCoalescer {
	/** 收到一次变更。 */
	schedule(): void;
	/** 取消尚未触发的定时器（订阅释放时调用）。 */
	dispose(): void;
}

export interface EmitCoalescerOptions {
	/** 静默这么久才认为「这一阵变更结束了」。 */
	readonly debounceMs: number;
	/** 两次实际投影之间的最小间隔，防止持续写入把间隔压到 0。 */
	readonly minIntervalMs: number;
	readonly emit: () => void;
	readonly now?: () => number;
	readonly setTimer?: (handler: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
	readonly clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

export function createEmitCoalescer(options: EmitCoalescerOptions): EmitCoalescer {
	const now = options.now ?? Date.now;
	const setTimer = options.setTimer ?? ((handler, delay) => setTimeout(handler, delay));
	const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
	let pending: ReturnType<typeof setTimeout> | undefined;
	let lastEmitAt = Number.NEGATIVE_INFINITY;
	let disposed = false;

	const fire = (): void => {
		pending = undefined;
		if (disposed) return;
		const wait = options.minIntervalMs - (now() - lastEmitAt);
		if (wait > 0) {
			// 太近：推迟而不是丢弃——否则最后一次变更永远发不出去，订阅方看到的是旧历史。
			pending = setTimer(fire, wait);
			return;
		}
		lastEmitAt = now();
		options.emit();
	};

	return {
		schedule(): void {
			if (disposed || pending) return;
			pending = setTimer(fire, options.debounceMs);
		},
		dispose(): void {
			disposed = true;
			if (pending) clearTimer(pending);
			pending = undefined;
		},
	};
}
