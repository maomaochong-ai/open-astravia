import type { SessionExecutionMode } from "@shared/store/atoms";
import { SidebarSessionSearchView } from "@vetta/theme-ui/project";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@vetta/ui";
import { useTranslation } from "react-i18next";
import { useSidebarSessionSearchModel } from "../../hooks/useSidebarSessionSearchModel";

interface SidebarSessionSearchProps {
	onOpenSession: (cwd: string, sessionPath?: string, executionMode?: SessionExecutionMode) => Promise<void>;
}

export function SidebarSessionSearch({ onOpenSession }: SidebarSessionSearchProps): JSX.Element {
	const { t, i18n } = useTranslation("project");
	const model = useSidebarSessionSearchModel({ onOpenSession, t, locale: i18n.resolvedLanguage || i18n.language });
	return (
		<Popover open={model.open} onOpenChange={(open) => (open ? model.openSearch() : model.close())}>
			<PopoverTrigger asChild>
				<Button
					className="no-drag"
					aria-expanded={model.open}
					aria-label={model.triggerLabel}
					size="icon-sm"
					title={model.triggerLabel}
					type="button"
					variant="ghost"
				>
					<span className="icon-[solar--magnifer-linear] size-4" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				aria-label={model.labels.title}
				align="start"
				className="no-drag w-[min(560px,calc(100vw-24px))] overflow-hidden rounded-xl p-0 shadow-lg"
				side="bottom"
				sideOffset={8}
				collisionPadding={12}
			>
				<SidebarSessionSearchView
					autoFocus
					activeFilters={model.activeFilters}
					filtersExpanded={model.filtersExpanded}
					timeFilter={model.timeFilter}
					onToggleFilters={model.toggleFilters}
					onResetFilters={model.resetFilters}
					error={model.error}
					items={model.items}
					labels={model.labels}
					loading={model.loading}
					onClose={model.close}
					onProjectChange={model.setSelectedProject}
					onQueryChange={model.setQuery}
					onTypeChange={model.setSelectedType}
					projectOptions={model.projectOptions}
					query={model.query}
					selectedProject={model.selectedProject}
					selectedType={model.selectedType}
					typeOptions={model.typeOptions}
				/>
			</PopoverContent>
		</Popover>
	);
}
