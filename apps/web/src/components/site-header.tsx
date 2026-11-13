import { AppHeader } from "./app-header";
import { HeaderAuth } from "./header-auth";

export function SiteHeader() {
	return <AppHeader actions={<HeaderAuth />} brandHref="/" />;
}
