import { expect, test } from "bun:test";
import { parseSessionDevice } from "../src/lib/session-device";

test.each([
	[
		"(X11; Linux x86_64) AppleWebKit/537.36 Chrome/132.0 Safari/537.36",
		"desktop",
		"Chrome on Linux",
	],
	[
		"(Windows NT 10.0) Gecko/20100101 Firefox/132.0",
		"desktop",
		"Firefox on Windows",
	],
	[
		"(Windows NT 10.0) Chrome/132.0 Safari/537.36 Edg/132.0",
		"desktop",
		"Edge on Windows",
	],
	[
		"(iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15 Safari/604.1",
		"mobile",
		"Safari on iPhone",
	],
	[
		"(iPad; CPU OS 17_0 like Mac OS X) CriOS/130 Mobile/15 Safari/604",
		"tablet",
		"Chrome on iPad",
	],
	[
		"(Macintosh; Intel Mac OS X 10_15) Version/17.0 Mobile/15 Safari/605.1",
		"tablet",
		"Safari on iPad",
	],
	[
		"(Linux; Android 14) Chrome/130 Safari/537.36",
		"tablet",
		"Chrome on Android",
	],
	[
		"(Linux; Android 14) Chrome/130 Mobile Safari/537.36",
		"mobile",
		"Chrome on Android",
	],
	[null, "desktop", "Unknown device"],
])("parses %s", (ua, type, label) => {
	expect(parseSessionDevice(ua)).toMatchObject({ type, label });
});
