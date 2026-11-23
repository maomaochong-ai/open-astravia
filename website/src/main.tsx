import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

import { Layout } from "./app/layout";
import { useDocumentMeta, useRoutePath } from "./app/router";
import { initTheme } from "./app/theme";
import { AboutPage } from "./pages/about";
import { DownloadPage } from "./pages/download";
import { FeaturesPage } from "./pages/features";
import { HomePage } from "./pages/home";

function App() {
	const path = useRoutePath();
	useDocumentMeta(path);

	const page =
		path === "/features" ? <FeaturesPage /> : path === "/download" ? <DownloadPage /> : path === "/about" ? <AboutPage /> : <HomePage />;

	return <Layout>{page}</Layout>;
}

initTheme();

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing from index.html");
createRoot(container).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
