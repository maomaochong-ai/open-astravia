// 相对时间描述符（与 ProjectsPanel.relativeTime 算法一致），返回 i18n key + count，
// 由组件用面板自己的 t() 渲染，避免把硬编码中文带进面板。

export interface RelativeTimeDescriptor {
	key: string;
	count?: number;
}

export function relativeTime(timestamp: number): RelativeTimeDescriptor {
	const minutes = Math.floor((Date.now() - timestamp) / 60_000);
	if (minutes < 1) return { key: "time.now" };
	if (minutes < 60) return { key: "time.minutes", count: minutes };
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return { key: "time.hours", count: hours };
	const days = Math.floor(hours / 24);
	if (days < 7) return { key: "time.days", count: days };
	const weeks = Math.floor(days / 7);
	if (weeks < 5) return { key: "time.weeks", count: weeks };
	const months = Math.floor(days / 30);
	if (months < 12) return { key: "time.months", count: months };
	return { key: "time.years", count: Math.floor(months / 12) };
}
