/**
 * 「这份设计的历史变了」的广播。
 *
 * 版本是在回合结束的 hook 里落的，与历史面板没有任何父子关系；面板自己只在挂载时
 * 拉一次列表，于是 agent 干完活、面板还停在旧列表上，用户得关掉重开才看得到新版本。
 * 用一个模块级的订阅把两边接起来，与 canvas/design-runtime 里画布控制器的做法同源。
 */
type Listener = (designDir: string) => void;

const listeners = new Set<Listener>();

/** 订阅历史变更。返回退订函数。 */
export function onHistoryChanged(listener: Listener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** 落了版本、恢复、进出查看模式之后调用。 */
export function notifyHistoryChanged(designDir: string): void {
	for (const listener of listeners) listener(designDir);
}
