"use client";

import { AlertCircle, RefreshCw } from "lucide-react";
import { useTheme } from "next-themes";
import {
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import { Button } from "../button";

const TURNSTILE_SCRIPT_URL =
	"https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SCRIPT_LOAD_TIMEOUT_MS = 10_000;
const TOKEN_WAIT_TIMEOUT_MS = 10_000;
const INTERACTIVE_WAIT_TIMEOUT_MS = 120_000;

interface TurnstileRenderOptions {
	action?: string;
	"after-interactive-callback"?: () => void;
	appearance?: "always" | "execute" | "interaction-only";
	"before-interactive-callback"?: () => void;
	callback?: (token: string) => void;
	"error-callback"?: (errorCode?: string) => void;
	execution?: "render" | "execute";
	"expired-callback"?: () => void;
	language?: string;
	sitekey: string;
	theme?: "auto" | "dark" | "light";
	"timeout-callback"?: () => void;
}

interface TurnstileApi {
	remove: (widgetId: string) => void;
	render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
	reset: (widgetId: string) => void;
}

declare global {
	interface Window {
		turnstile?: TurnstileApi;
	}
}

export interface TurnstileHandle {
	getToken: () => Promise<string>;
	reset: () => void;
}

export interface TurnstileTranslations {
	failed: string;
	retry: string;
	unavailable: string;
}

export interface TurnstileWidgetProps {
	action?: string;
	language?: string;
	nonce?: string;
	ref?: React.Ref<TurnstileHandle>;
	siteKey: string;
	translations: TurnstileTranslations;
}

export class CaptchaUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CaptchaUnavailableError";
	}
}

let turnstileScriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstileScript(nonce?: string): Promise<TurnstileApi> {
	if (typeof window === "undefined") {
		return Promise.reject(
			new CaptchaUnavailableError("Turnstile cannot load on the server")
		);
	}

	if (window.turnstile) {
		return Promise.resolve(window.turnstile);
	}

	if (turnstileScriptPromise) {
		return turnstileScriptPromise;
	}

	turnstileScriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
		const existingScript = document.querySelector<HTMLScriptElement>(
			`script[src="${TURNSTILE_SCRIPT_URL}"]`
		);
		const script = existingScript ?? document.createElement("script");

		const cleanup = (activeTimerId: ReturnType<typeof setTimeout>) => {
			clearTimeout(activeTimerId);
			script.removeEventListener("load", handleLoad);
			script.removeEventListener("error", handleError);
		};

		const failLoad = (
			activeTimerId: ReturnType<typeof setTimeout>,
			reason: string
		) => {
			cleanup(activeTimerId);
			turnstileScriptPromise = null;
			script.remove();
			reject(new CaptchaUnavailableError(reason));
		};

		const timerId = setTimeout(() => {
			failLoad(timerId, "Turnstile script timed out");
		}, SCRIPT_LOAD_TIMEOUT_MS);

		const handleLoad = () => {
			if (window.turnstile) {
				cleanup(timerId);
				resolve(window.turnstile);
				return;
			}
			failLoad(timerId, "Turnstile API unavailable after script load");
		};

		const handleError = () => {
			failLoad(timerId, "Turnstile script failed to load");
		};

		script.addEventListener("load", handleLoad);
		script.addEventListener("error", handleError);

		if (!existingScript) {
			script.src = TURNSTILE_SCRIPT_URL;
			script.async = true;
			script.defer = true;
			if (nonce) {
				script.nonce = nonce;
			}
			document.head.appendChild(script);
		}
	});

	return turnstileScriptPromise;
}

function resolveTurnstileTheme(
	resolvedTheme: string | undefined
): "light" | "dark" | "auto" {
	if (resolvedTheme === "dark") {
		return "dark";
	}
	if (resolvedTheme === "light") {
		return "light";
	}
	return "auto";
}

interface PendingResolver {
	reject: (error: Error) => void;
	resolve: (token: string) => void;
	timerId: ReturnType<typeof setTimeout>;
}

export function TurnstileWidget({
	siteKey,
	action,
	language,
	nonce,
	translations,
	ref,
}: TurnstileWidgetProps) {
	const { resolvedTheme } = useTheme();
	const containerRef = useRef<HTMLDivElement>(null);
	const widgetIdRef = useRef<string | null>(null);
	const tokenRef = useRef<string | null>(null);
	const statusRef = useRef<"loading" | "ready" | "interactive" | "error">(
		"loading"
	);
	const pendingResolversRef = useRef<PendingResolver[]>([]);
	const mountGenerationRef = useRef(0);
	const [hasMounted, setHasMounted] = useState(false);
	const [status, setStatus] = useState<
		"loading" | "ready" | "interactive" | "error"
	>("loading");

	useEffect(() => {
		setHasMounted(true);
	}, []);

	const updateStatus = useCallback(
		(next: "loading" | "ready" | "interactive" | "error") => {
			statusRef.current = next;
			setStatus(next);
		},
		[]
	);

	const resolvePending = useCallback((token: string) => {
		const pending = pendingResolversRef.current;
		pendingResolversRef.current = [];
		for (const item of pending) {
			clearTimeout(item.timerId);
			item.resolve(token);
		}
	}, []);

	const rejectPending = useCallback((error: Error) => {
		const pending = pendingResolversRef.current;
		pendingResolversRef.current = [];
		for (const item of pending) {
			clearTimeout(item.timerId);
			item.reject(error);
		}
	}, []);

	const turnstileTheme = resolveTurnstileTheme(resolvedTheme);

	const mountWidget = useCallback(() => {
		mountGenerationRef.current += 1;
		const generation = mountGenerationRef.current;
		tokenRef.current = null;
		updateStatus("loading");

		loadTurnstileScript(nonce)
			.then((turnstile) => {
				if (
					mountGenerationRef.current !== generation ||
					!containerRef.current
				) {
					return;
				}
				if (widgetIdRef.current) {
					turnstile.remove(widgetIdRef.current);
					widgetIdRef.current = null;
				}

				const handleTokenReset = () => {
					if (mountGenerationRef.current !== generation) {
						return;
					}
					tokenRef.current = null;
					updateStatus("loading");
					if (widgetIdRef.current) {
						turnstile.reset(widgetIdRef.current);
					}
				};

				widgetIdRef.current = turnstile.render(containerRef.current, {
					action,
					appearance: "interaction-only",
					execution: "render",
					language,
					sitekey: siteKey,
					theme: turnstileTheme,
					callback: (token) => {
						if (mountGenerationRef.current !== generation) {
							return;
						}
						tokenRef.current = token;
						updateStatus("ready");
						resolvePending(token);
					},
					"before-interactive-callback": () => {
						if (mountGenerationRef.current !== generation) {
							return;
						}
						updateStatus("interactive");
						for (const item of pendingResolversRef.current) {
							clearTimeout(item.timerId);
							item.timerId = setTimeout(() => {
								pendingResolversRef.current =
									pendingResolversRef.current.filter((entry) => entry !== item);
								item.reject(
									new CaptchaUnavailableError(translations.unavailable)
								);
							}, INTERACTIVE_WAIT_TIMEOUT_MS);
						}
					},
					"after-interactive-callback": () => {
						if (mountGenerationRef.current !== generation) {
							return;
						}
						updateStatus(tokenRef.current ? "ready" : "loading");
					},
					"expired-callback": handleTokenReset,
					"timeout-callback": handleTokenReset,
					"error-callback": () => {
						if (mountGenerationRef.current !== generation) {
							return;
						}
						tokenRef.current = null;
						updateStatus("error");
						rejectPending(
							new CaptchaUnavailableError(translations.unavailable)
						);
					},
				});
			})
			.catch((error: unknown) => {
				if (mountGenerationRef.current !== generation) {
					return;
				}
				tokenRef.current = null;
				updateStatus("error");
				rejectPending(
					error instanceof Error
						? error
						: new CaptchaUnavailableError(translations.unavailable)
				);
			});
	}, [
		action,
		language,
		nonce,
		rejectPending,
		resolvePending,
		siteKey,
		translations.unavailable,
		turnstileTheme,
		updateStatus,
	]);

	const resetWidget = useCallback(() => {
		tokenRef.current = null;
		rejectPending(
			new CaptchaUnavailableError("Security check was reset before completion")
		);
		if (window.turnstile && widgetIdRef.current) {
			updateStatus("loading");
			window.turnstile.reset(widgetIdRef.current);
			return;
		}
		mountWidget();
	}, [mountWidget, rejectPending, updateStatus]);

	useImperativeHandle(
		ref,
		() => ({
			getToken: () => {
				if (tokenRef.current) {
					return Promise.resolve(tokenRef.current);
				}

				if (statusRef.current === "error") {
					resetWidget();
				}

				const timeoutMs =
					statusRef.current === "interactive"
						? INTERACTIVE_WAIT_TIMEOUT_MS
						: TOKEN_WAIT_TIMEOUT_MS;

				return new Promise<string>((resolve, reject) => {
					const entry: PendingResolver = {
						reject,
						resolve,
						timerId: setTimeout(() => {
							pendingResolversRef.current = pendingResolversRef.current.filter(
								(item) => item !== entry
							);
							reject(new CaptchaUnavailableError(translations.unavailable));
						}, timeoutMs),
					};
					pendingResolversRef.current.push(entry);
				});
			},
			reset: resetWidget,
		}),
		[resetWidget, translations.unavailable]
	);

	useEffect(() => {
		if (!hasMounted) {
			return;
		}
		mountWidget();

		return () => {
			mountGenerationRef.current += 1;
			tokenRef.current = null;
			rejectPending(
				new CaptchaUnavailableError(
					"Security check was reset before completion"
				)
			);
			if (widgetIdRef.current && window.turnstile) {
				window.turnstile.remove(widgetIdRef.current);
				widgetIdRef.current = null;
			}
		};
	}, [hasMounted, mountWidget, rejectPending]);

	return (
		<div className="space-y-2">
			<div
				className={
					status === "interactive"
						? "flex justify-center pt-1"
						: "flex justify-center"
				}
				ref={containerRef}
			/>
			{status === "error" ? (
				<div
					className="bg-destructive/10 text-destructive border-destructive/20 flex flex-col gap-2 rounded-md border p-3 text-xs"
					role="alert"
				>
					<div className="flex items-start gap-2">
						<AlertCircle
							aria-hidden="true"
							className="mt-0.5 h-4 w-4 shrink-0"
						/>
						<span>{translations.unavailable}</span>
					</div>
					<div>
						<Button
							className="h-7 gap-1.5 px-2.5 text-xs"
							onClick={resetWidget}
							type="button"
							variant="outline"
						>
							<RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
							{translations.retry}
						</Button>
					</div>
				</div>
			) : null}
		</div>
	);
}
