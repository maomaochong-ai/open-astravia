/**
 * 卡片上的相对时间（「3 分钟前」）。纯函数：now 显式传入，locale 只认 zh/en 前缀。
 * 超过 7 天退化为日期——太久远的「xx 天前」需要用户心算，不如直接给日期。
 */
export function formatRelativeTime(now: number, timestamp: number, locale: string): string {
	const zh = locale.toLowerCase().startsWith("zh");
	const diff = Math.max(0, now - timestamp);
	const minute = 60_000;
	const hour = 60 * minute;
	const day = 24 * hour;

	if (diff < minute) return zh ? "刚刚" : "just now";
	if (diff < hour) {
		const minutes = Math.floor(diff / minute);
		return zh ? `${minutes} 分钟前` : `${minutes}m ago`;
	}
	if (diff < day) {
		const hours = Math.floor(diff / hour);
		return zh ? `${hours} 小时前` : `${hours}h ago`;
	}
	if (diff < 7 * day) {
		const days = Math.floor(diff / day);
		return zh ? `${days} 天前` : `${days}d ago`;
	}
	const date = new Date(timestamp);
	const month = date.getMonth() + 1;
	const dayOfMonth = date.getDate();
	return zh ? `${month} 月 ${dayOfMonth} 日` : `${month}/${dayOfMonth}`;
}
