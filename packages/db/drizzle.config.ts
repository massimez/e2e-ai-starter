import { APP_CONFIG } from "@workspace/shared/config";
import { defineConfig } from "drizzle-kit";

function getDatabaseUrl(): string {
	const url = process.env.DATABASE_URL;
	if (url) {
		return url;
	}
	if (process.env.NODE_ENV === "production") {
		throw new Error(
			"DATABASE_URL environment variable is required in production"
		);
	}
	return `postgresql://postgres:postgres@localhost:5432/${APP_CONFIG.defaultDatabaseName}`;
}

export default defineConfig({
	schema: "./src/schema",
	out: "./migrations",
	dialect: "postgresql",
	schemaFilter: ["public"],
	dbCredentials: {
		url: getDatabaseUrl(),
	},
});
