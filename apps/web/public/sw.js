self.addEventListener("push", (event) => {
	let payload = {
		body: "You have a new workspace notification.",
		data: { url: "/dashboard" },
		title: "Notification",
	};

	if (event.data) {
		try {
			const parsed = event.data.json();
			payload = {
				body: typeof parsed.body === "string" ? parsed.body : payload.body,
				data: parsed.data && typeof parsed.data === "object" ? parsed.data : {},
				title: typeof parsed.title === "string" ? parsed.title : payload.title,
			};
		} catch {
			payload.body = event.data.text() || payload.body;
		}
	}

	event.waitUntil(
		self.registration.showNotification(payload.title, {
			body: payload.body,
			data: payload.data,
		})
	);
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const rawUrl = event.notification.data?.url || "/dashboard";
	const safePath =
		typeof rawUrl === "string" &&
		rawUrl.startsWith("/") &&
		!rawUrl.startsWith("//")
			? rawUrl
			: "/dashboard";

	event.waitUntil(
		self.clients
			.matchAll({ includeUncontrolled: true, type: "window" })
			.then((clientList) => {
				for (const client of clientList) {
					if (
						"focus" in client &&
						client.url.startsWith(self.location.origin)
					) {
						return client.navigate(safePath).then((navigated) => {
							if (navigated) {
								return navigated.focus();
							}
							return client.focus();
						});
					}
				}
				return self.clients.openWindow(safePath);
			})
	);
});
