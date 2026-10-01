/**
 * 画布侧拼 frame 地址。路径规则由引擎的 routes.ts 定义（设计稿即工程：一个
 * frame 一条真实路由），这里只负责套上 dev server 的 origin —— 规则本身直接
 * 复用引擎那份，避免两边各写一套后悄悄漂开。
 */
import { pathOfFrame } from "../../engine/src/routes";

export { pathOfFrame } from "../../engine/src/routes";

/**
 * `reloadNonce` 走查询串而不是 hash：改 hash 只会触发 hashchange，文档不会重新
 * 加载，而刷新按钮要的正是一次真正的重新导航。
 */
export function frameUrl(port: number, frameId: string, reloadNonce?: number): string {
	const path = encodeURI(pathOfFrame(frameId));
	const query = reloadNonce === undefined ? "" : `?r=${reloadNonce}`;
	return `http://127.0.0.1:${port}${path}${query}`;
}
