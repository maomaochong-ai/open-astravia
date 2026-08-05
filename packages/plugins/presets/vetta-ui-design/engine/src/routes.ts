/**
 * Frame ↔ URL 映射。
 *
 * 设计稿即工程：`frames/login.tsx` 就是 `/login`，`frames/index.tsx` 就是站点
 * 首页 `/`。画布、预览、系统浏览器、以及将来直接部署出去的静态站点用的是同一
 * 套地址，frame 源码里的 `<Link to="/login">` 在四个环境里都成立。
 */

/** 约定：这个 id 的 frame 就是首页。 */
export const HOME_FRAME_ID = "index";

/** 路由路径。Route 的 path 与导航目标共用它，所以这里不做 URL 编码。 */
export function pathOfFrame(frameId: string): string {
	return frameId === HOME_FRAME_ID ? "/" : `/${frameId}`;
}

/**
 * 首页落到哪一帧：有 `index.tsx` 就是它，否则回落到字典序第一帧——引擎看不到
 * 画布 manifest，「最左上那帧」这种画布概念在这一层不存在。
 */
export function homeFrameId(frameIds: readonly string[]): string | null {
	if (frameIds.includes(HOME_FRAME_ID)) return HOME_FRAME_ID;
	return frameIds[0] ?? null;
}

/** 反向解析，用于把当前地址报回画布（预览工具条要显示它）。 */
export function frameOfPath(pathname: string, frameIds: readonly string[]): string | null {
	const segment = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
	if (segment === "") return homeFrameId(frameIds);
	const id = decodeURIComponent(segment);
	return frameIds.includes(id) ? id : null;
}
