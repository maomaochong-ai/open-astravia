import { type PluginFilePreviewProps, useTranslation } from "@astravia-org/plugin-sdk";
import { useEffect, useState, type JSX } from "react";
import { DocxPreview } from "./components/DocxPreview";
import { ErrorState } from "./components/PreviewState";
import { PdfPreview } from "./components/PdfPreview";
import { PptxPreview } from "./components/PptxPreview";
import { SpreadsheetPreview } from "./components/spreadsheet/SpreadsheetPreview";
import { isSpreadsheetExtension } from "./office-formats";

export function OfficePreview(props: PluginFilePreviewProps): JSX.Element {
	const { t } = useTranslation();
	const [revision, setRevision] = useState(0);

	useEffect(() => {
		const watcher = props.file.watch(() => setRevision((value) => value + 1));
		return () => watcher.dispose();
	}, [props.file]);

	if (props.file.extension === "pdf") {
		return <PdfPreview key={revision} {...props} />;
	}
	if (props.file.extension === "docx") {
		return <DocxPreview key={revision} {...props} />;
	}
	if (props.file.extension === "pptx") {
		return <PptxPreview key={revision} {...props} />;
	}
	if (isSpreadsheetExtension(props.file.extension)) {
		return <SpreadsheetPreview key={revision} {...props} />;
	}
	return <ErrorState message={t("error.unsupportedFormat")} />;
}
