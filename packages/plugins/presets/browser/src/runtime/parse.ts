/**
 * 从 `npm i -g agent-browser` 的输出里判断本机是否已有系统 Chrome。
 *
 * agent-browser 的 postinstall 会明确打印其中一条提示。据此决定要不要再跑一次
 * `agent-browser install`——那一步会下载几百 MB 的 Chrome for Testing，在用户
 * 已经装了 Chrome 时纯属浪费，不能默认就拉。
 *
 * 解析上游控制台文案确实脆弱，所以判不出来时返回 null，由面板降级成「让用户自己决定」，
 * 而不是替他做主。
 */
export function detectSystemChrome(installOutput: string): boolean | null {
	if (/System Chrome found/i.test(installOutput)) return true;
	if (/No Chrome installation detected/i.test(installOutput)) return false;
	return null;
}
