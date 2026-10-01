declare module "*.jsx" {
	import type { ComponentType } from "react";
	const component: ComponentType;
	export default component;
}

declare module "*.svg?raw" {
	const content: string;
	export default content;
}
