/**
 * 从命令输出里认出「这里起了一个本机可访问的服务」。
 *
 * 开发服务器几乎都会把地址打出来（`Local: http://localhost:5173/`、
 * `Starting development server at http://127.0.0.1:8000/`），这是最省事也最准的线索：远端扫描
 * 要一次 SSH 往返，还可能因为远端没有 ss/netstat/lsof 而完全不可用，而输出本来就已经在手上。
 *
 * 只认地址形态，不认「port 3000」这类散句——后者会把日志里的 `port 22 closed` 也算进来，
 * 摆一个转不通的端口给用户比少认一个更糟。
 */
const ADDRESS_PATTERN = /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{2,5})\b/gi;

/** 一次最多认这么多个：跑歪的日志不该把候选列表刷满。 */
const MAX_PORTS = 20;

/** 输出里出现过的端口号，按出现顺序去重。 */
export function detectPortsInOutput(text: string): number[] {
	const ports: number[] = [];
	const seen = new Set<number>();
	for (const match of text.matchAll(ADDRESS_PATTERN)) {
		const port = Number.parseInt(match[1] ?? "", 10);
		if (!Number.isInteger(port) || port <= 0 || port > 65535 || seen.has(port)) continue;
		seen.add(port);
		ports.push(port);
		if (ports.length >= MAX_PORTS) break;
	}
	return ports;
}
