import {
	BatchFlow,
	BatchTasks,
	ConceptMap,
	DataFlow,
	EvidenceGrid,
	Lifecycle,
	MediaFrame,
	Relationship,
	RelationshipChildren,
	RelationshipRoot,
} from "@/components/figures";
import {
	HomeActions,
	HomeEmphasis,
	HomeFlow,
	HomeFooter,
	HomeHero,
	HomeHeroCopy,
	HomeIndex,
	HomeIndexGroup,
	HomeIndexLink,
	HomeInlineLink,
	HomeLead,
	HomeMascot,
	HomeOutcomes,
	HomePrimary,
	HomeProduct,
	HomeProductBar,
	HomeProductCaption,
	HomeProductImage,
	HomeProof,
	HomeSecondary,
	HomeSection,
	HomeSectionHeading,
	HomeTitle,
} from "@/components/home";
import { DocsKicker } from "@/components/kicker";
import { Accordion, Accordions } from "fumadocs-ui/components/accordion";
import { File, Files, Folder } from "fumadocs-ui/components/files";
import { ImageZoom } from "fumadocs-ui/components/image-zoom";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { TypeTable } from "fumadocs-ui/components/type-table";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

export function getMDXComponents(components?: MDXComponents) {
	return {
		...defaultMdxComponents,
		Steps,
		Step,
		Tabs,
		Tab,
		Files,
		Folder,
		File,
		Accordions,
		Accordion,
		TypeTable,
		ImageZoom,
		DocsKicker,
		HomeHero,
		HomeHeroCopy,
		HomeTitle,
		HomeEmphasis,
		HomeLead,
		HomeActions,
		HomePrimary,
		HomeSecondary,
		HomeProof,
		HomeProduct,
		HomeProductBar,
		HomeProductImage,
		HomeProductCaption,
		HomeMascot,
		HomeSection,
		HomeSectionHeading,
		HomeFlow,
		HomeInlineLink,
		HomeIndex,
		HomeIndexGroup,
		HomeIndexLink,
		HomeOutcomes,
		HomeFooter,
		MediaFrame,
		ConceptMap,
		EvidenceGrid,
		Relationship,
		RelationshipRoot,
		RelationshipChildren,
		BatchFlow,
		BatchTasks,
		Lifecycle,
		DataFlow,
		...components,
	} satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
	type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
