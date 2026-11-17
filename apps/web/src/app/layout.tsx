import "@workspace/ui/styles/globals.css";
import { APP_CONFIG } from "@workspace/api/config";
import { Toaster } from "@workspace/ui/components/sonner";
import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import { headers } from "next/headers";
import { publicWebEnv } from "@/env";
import { AuthProvider } from "@/providers/auth-provider";
import { QueryProvider } from "@/providers/query-provider";
import { ThemeProvider } from "@/providers/theme-provider";

const ibmPlexSans = IBM_Plex_Sans({
	display: "swap",
	subsets: ["latin"],
	variable: "--font-ibm-plex-sans",
});

const jetbrainsMono = JetBrains_Mono({
	display: "swap",
	subsets: ["latin"],
	variable: "--font-jetbrains-mono",
});

const SITE_TITLE = `${APP_CONFIG.name}: ${APP_CONFIG.tagline}`;
const SITE_DESCRIPTION = APP_CONFIG.description;

export const metadata: Metadata = {
	applicationName: APP_CONFIG.name,
	authors: [{ name: APP_CONFIG.name }],
	creator: APP_CONFIG.name,
	description: SITE_DESCRIPTION,
	keywords: [...APP_CONFIG.keywords],
	metadataBase: new URL(publicWebEnv.appUrl),
	openGraph: {
		description: SITE_DESCRIPTION,
		siteName: APP_CONFIG.name,
		title: SITE_TITLE,
		type: "website",
	},
	publisher: APP_CONFIG.name,
	robots: {
		follow: true,
		index: true,
	},
	title: {
		default: SITE_TITLE,
		template: `%s | ${APP_CONFIG.name}`,
	},
	twitter: {
		card: "summary_large_image",
		description: SITE_DESCRIPTION,
		title: SITE_TITLE,
	},
};

export const viewport: Viewport = {
	colorScheme: "light dark",
};

export default async function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const nonce = (await headers()).get("x-nonce") ?? undefined;

	return (
		<html
			className={`${ibmPlexSans.variable} ${jetbrainsMono.variable}`}
			lang="en"
			suppressHydrationWarning
		>
			<body className="bg-background text-foreground min-h-screen font-sans antialiased">
				<a
					className="bg-background text-foreground focus-visible:ring-ring sr-only fixed top-3 left-3 z-50 rounded-md px-3 py-2 text-sm font-medium shadow-md focus:not-sr-only focus:outline-none focus-visible:ring-2"
					href="#main-content"
				>
					Skip to main content
				</a>
				<ThemeProvider
					attribute="class"
					defaultTheme="system"
					disableTransitionOnChange
					enableSystem
					nonce={nonce}
				>
					<QueryProvider>
						<AuthProvider nonce={nonce}>
							{children}
							<Toaster position="bottom-right" richColors />
						</AuthProvider>
					</QueryProvider>
				</ThemeProvider>
			</body>
		</html>
	);
}
