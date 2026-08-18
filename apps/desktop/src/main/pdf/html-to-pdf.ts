import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { BrowserWindow } from "electron";

export interface HtmlToPdfInput {
	htmlPath: string;
	outputPath: string;
	pageSize?: "A4";
	margins?: {
		top: number;
		right: number;
		bottom: number;
		left: number;
	};
}

export async function renderHtmlFileToPdf(input: HtmlToPdfInput): Promise<void> {
	const win = new BrowserWindow({
		show: false,
		width: 1055,
		height: 1492,
		webPreferences: {
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});

	try {
		await win.loadURL(pathToFileURL(input.htmlPath).toString());
		await win.webContents.executeJavaScript("document.fonts ? document.fonts.ready : true");
		const pdf = await win.webContents.printToPDF({
			pageSize: input.pageSize ?? "A4",
			printBackground: true,
			displayHeaderFooter: false,
			preferCSSPageSize: true,
			margins: input.margins
				? {
						marginType: "custom",
						top: input.margins.top,
						right: input.margins.right,
						bottom: input.margins.bottom,
						left: input.margins.left,
					}
				: undefined,
		});
		await writeFile(input.outputPath, pdf);
	} finally {
		win.close();
	}
}
