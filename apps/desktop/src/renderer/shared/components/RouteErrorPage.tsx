import { Link, type ErrorComponentProps } from "@tanstack/react-router";
import { RouteErrorPageView } from "@vetta/theme-ui/overlays";
import { useRouteErrorPageModel } from "../hooks/useRouteErrorPageModel";
import { Button } from "./ui/button";

export function RouteErrorPage(props: ErrorComponentProps): JSX.Element {
	const model = useRouteErrorPageModel(props);
	return (
		<RouteErrorPageView
			{...model}
			homeAction={
				<Button type="button" variant="outline" asChild>
					<Link to="/">{model.labels.home}</Link>
				</Button>
			}
		/>
	);
}
