/**
 * 一次 open 在 `session.create` 返回前被更新操作取代时，主进程可能已经落盘了一个会话文件。
 *
 * 区分两种取代：
 * - 新建会话（本次 open 没带 sessionPath）：落盘的是刚建出来的空壳。不删会在侧边栏留下
 *   一个没有 activeSession 归属的「未命名会话」。
 * - 已有会话（本次 open 带着 sessionPath）：create 只是取回 Runtime 句柄，返回的路径就是
 *   用户真正的对话文件。删它等于删掉会话本身，主进程还会连带 `rm -rf` 掉该会话的
 *   per-session 子目录（`desktop-session-commands.ts` 的 delete 语义）。
 *
 * 所以只有「本次 open 亲手新建」的路径可以回收。快速连续点击不同会话正是这条路径最容易
 * 被触发的时候，而它的后果是用户的会话凭空消失。
 */
export function reclaimableSupersededSessionPath(input: {
	readonly isExistingSessionOpen: boolean;
	readonly sessionPath: string | undefined;
}): string | undefined {
	if (input.isExistingSessionOpen) return undefined;
	return input.sessionPath || undefined;
}
