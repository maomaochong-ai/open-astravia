/**
 * introspection 并发限流（主题F：加载编排）。
 *
 * 展开连接/表时会并发触发多处 introspection（listCatalogScopes、
 * listTables、describeTable、listTableObjectNames…）。数据库驱动
 * 是共享的单个后端连接，无限制并发会把单个展开动作放大成几十个
 * 并行 IPC + 后端往返，造成明显的卡顿与错乱。
 *
 * 本模块提供一个模块级 FIFO 信号量：同一时刻最多 MAX_CONCURRENT
 * 个 introspection 在途，其余排队；任务结束后按入队顺序放行。
 * 纯 TS、无 React 依赖，可独立单测。
 */

/** 同时允许在途的 introspection 请求数。 */
export const MAX_CONCURRENT_INTROSPECTION = 2;

type Pending = { run: () => void };

let inFlight = 0;
const queue: Pending[] = [];

function pump(): void {
	while (inFlight < MAX_CONCURRENT_INTROSPECTION && queue.length > 0) {
		const next = queue.shift();
		if (!next) continue;
		inFlight += 1;
		next.run();
	}
}

function settle(): void {
	inFlight -= 1;
	pump();
}

/**
 * 以受限并发执行 introspection 任务。
 * 返回任务结果；任务抛错时原样向外传播。
 * 当并发未达上限时直接执行，无额外延迟。
 */
export function runIntrospection<T>(task: () => Promise<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		queue.push({
			run: () => {
				Promise.resolve()
					.then(task)
					.then(
						(value) => {
							settle();
							resolve(value);
						},
						(error: unknown) => {
							settle();
							reject(error);
						},
					);
			},
		});
		pump();
	});
}

/** 当前在途请求数（测试/诊断用）。 */
export function introspectionInFlight(): number {
	return inFlight;
}

/** 当前排队请求数（测试/诊断用）。 */
export function introspectionQueued(): number {
	return queue.length;
}
