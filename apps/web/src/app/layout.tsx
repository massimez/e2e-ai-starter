import "@workspace/ui/styles/globals.css";
import { APP_CONFIG } from "@workspace/api/config";
import { Toaster } from "@workspace/ui/components/sonner";
import type { Metadata } from "next";
import { IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
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
	description: SITE_DESCRIPTION,
	metadataBase: new URL(publicWebEnv.appUrl),
	openGraph: {
		description: SITE_DESCRIPTION,
		siteName: APP_CONFIG.name,
		title: SITE_TITLE,
		type: "website",
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

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html
			className={`${ibmPlexSans.variable} ${jetbrainsMono.variable}`}
			lang="en"
			suppressHydrationWarning
		>
			<body className="bg-background text-foreground min-h-screen font-sans antialiased">
				<ThemeProvider
					attribute="class"
					defaultTheme="system"
					disableTransitionOnChange
					enableSystem
				>
					<QueryProvider>
						<AuthProvider>
							{children}
							<Toaster position="bottom-right" richColors />
						</AuthProvider>
					</QueryProvider>
				</ThemeProvider>
			</body>
		</html>
	);
}
