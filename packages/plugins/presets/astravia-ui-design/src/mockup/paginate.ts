/**
 * 分页：一张导出图放几个画框由用户在工作台里选，放不下的排到下一页。
 * 单独成文件是因为预览、导出、页码文案三处必须看到同一份分页结果。
 */
export function paginate<T>(items: readonly T[], perPage: number): T[][] {
	const size = Math.max(1, Math.floor(perPage));
	const pages: T[][] = [];
	for (let index = 0; index < items.length; index += size) {
		pages.push(items.slice(index, index + size));
	}
	return pages;
}
