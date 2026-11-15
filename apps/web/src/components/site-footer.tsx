import { APP_CONFIG } from "@workspace/api/config";
import {
	AppleIcon,
	FacebookIcon,
	GitHubIcon,
	GoogleIcon,
	InstagramIcon,
	LinkedInIcon,
	TelegramIcon,
	TikTokIcon,
	WhatsAppIcon,
	XIcon,
	YouTubeIcon,
} from "@workspace/ui/components/icons/brands";

const BRAND_LINKS = [
	{ name: "GitHub", href: "https://github.com", Icon: GitHubIcon },
	{ name: "X", href: "https://x.com", Icon: XIcon },
	{ name: "LinkedIn", href: "https://linkedin.com", Icon: LinkedInIcon },
	{ name: "YouTube", href: "https://youtube.com", Icon: YouTubeIcon },
	{ name: "Google", href: "https://google.com", Icon: GoogleIcon },
	{ name: "Apple", href: "https://apple.com", Icon: AppleIcon },
	{ name: "Instagram", href: "https://instagram.com", Icon: InstagramIcon },
	{ name: "Facebook", href: "https://facebook.com", Icon: FacebookIcon },
	{ name: "TikTok", href: "https://tiktok.com", Icon: TikTokIcon },
	{ name: "Telegram", href: "https://telegram.org", Icon: TelegramIcon },
	{ name: "WhatsApp", href: "https://whatsapp.com", Icon: WhatsAppIcon },
] as const;

export function SiteFooter() {
	return (
		<footer className="border-border/70 text-muted-foreground w-full border-t">
			<div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-8 text-xs sm:px-6 lg:flex-row lg:items-center lg:justify-between">
				<div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
					<span className="text-foreground font-medium">{APP_CONFIG.name}</span>
					<span>
						Next.js 16, Hono, Better Auth, Drizzle ORM, Mastra AI, pgvector,
						S3/R2, and BullMQ.
					</span>
				</div>

				<div className="flex flex-wrap items-center justify-between gap-4">
					<nav
						aria-label="Community channels"
						className="flex flex-wrap items-center gap-1"
					>
						{BRAND_LINKS.map(({ name, href, Icon }) => (
							<a
								aria-label={`${name} (opens in a new tab)`}
								className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring inline-flex size-11 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
								href={href}
								key={name}
								rel="noopener noreferrer"
								target="_blank"
							>
								<Icon aria-hidden="true" className="size-4" />
							</a>
						))}
					</nav>

					<nav
						aria-label="Footer"
						className="flex flex-wrap items-center gap-5"
					>
						<a
							className="hover:text-foreground focus-visible:ring-ring rounded-sm font-mono transition-colors focus-visible:ring-2 focus-visible:outline-none"
							href="/api/health/ready"
						>
							/api/health/ready
						</a>
					</nav>
				</div>
			</div>
		</footer>
	);
}
