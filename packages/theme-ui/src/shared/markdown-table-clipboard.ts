/**
 * 表格「复制」的纯逻辑。取数源是渲染后的 DOM —— 渲染结果就是用户看到的真相，
 * 不需要把原始 markdown 一路串到表格组件里。
 */

/** 把 `<table>` 读成二维字符串矩阵，首行即表头。 */
export function readTableCells(table: HTMLTableElement): string[][] {
	return Array.from(table.rows).map((row) =>
		Array.from(row.cells).map((cell) => (cell.textContent ?? "").trim().replace(/\s+/g, " ")),
	);
}

/** 还原成 GFM 表格。列数按最宽的一行对齐，短行补空单元格。 */
export function toMarkdown(rows: string[][]): string {
	if (rows.length === 0) return "";
	const columnCount = Math.max(...rows.map((row) => row.length));
	const pad = (row: string[]): string[] =>
		Array.from({ length: columnCount }, (_, index) => (row[index] ?? "").replace(/\|/g, "\\|"));
	const [header, ...body] = rows;
	return [
		`| ${pad(header).join(" | ")} |`,
		`| ${Array.from({ length: columnCount }, () => "---").join(" | ")} |`,
		...body.map((row) => `| ${pad(row).join(" | ")} |`),
	].join("\n");
}

/** RFC 4180 引号规则，直接可粘进 Excel / Numbers。 */
export function toCsv(rows: string[][]): string {
	const quote = (value: string): string => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
	return rows.map((row) => row.map(quote).join(",")).join("\n");
}
