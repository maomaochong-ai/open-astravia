/**
 * 等一个可能永不结算的 Promise，但只等到 deadline。
 *
 * IPC 处理函数必须回复：一旦它挂住，渲染进程那边的按钮就会一直停在「进行中」，
 * 用户看到的是一个点不动、也没法再点的按钮。回复晚于 deadline 时，迟到的工作
 * 继续在后台跑，只是不再有人等它。
 *
 * `promise` 的拒绝视为已结算——调用方要的是「还该不该等」，不是结果。
 */
export async function settleWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<boolean>((resolve) => {
		timer = setTimeout(() => resolve(false), timeoutMs);
	});
	try {
		return await Promise.race([
			promise.then(
				() => true,
				() => true,
			),
			deadline,
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
