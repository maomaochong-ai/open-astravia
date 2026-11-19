/**
 * jsdom 不实现 matchMedia，而主题 hook 在初始化时就会读它。
 * 测试里给一个固定的「深色偏好」，行为与真实浏览器首次访问一致。
 */
if (typeof window !== "undefined" && !window.matchMedia) {
	window.matchMedia = (query: string) =>
		({
			matches: query.includes("dark"),
			media: query,
			onchange: null,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			addListener: () => undefined,
			removeListener: () => undefined,
			dispatchEvent: () => false,
		}) as MediaQueryList;
}
