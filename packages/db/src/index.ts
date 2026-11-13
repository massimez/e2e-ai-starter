import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

export interface DbOptions {
	connectTimeout?: number;
	idleTimeout?: number;
	max?: number;
	maxLifetime?: number;
	prepare?: boolean;
	ssl?: boolean | "require" | "prefer";
}

type Schema = typeof schema;
export type Database = ReturnType<typeof drizzle<Schema>>;

function parseMaxConnections(override?: number): number {
	if (override !== undefined) {
		return override;
	}

	const raw = process.env.DB_MAX_CONNECTIONS;
	if (raw !== undefined && raw.trim() !== "") {
		const parsed = Number(raw);
		if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
			throw new Error(
				`Invalid DB_MAX_CONNECTIONS value "${raw}": expected integer between 1 and 200`
			);
		}
		return parsed;
	}

	return process.env.NODE_ENV === "production" ? 20 : 10;
}

function resolveSslOption(
	databaseUrl: string,
	override?: DbOptions["ssl"]
): postgres.Options<Record<string, never>>["ssl"] {
	if (override !== undefined) {
		return override;
	}
	if (
		process.env.DATABASE_SSL === "true" ||
		databaseUrl.includes("sslmode=require")
	) {
		return "require";
	}
	return undefined;
}

function buildClient(databaseUrl: string, options: DbOptions = {}) {
	const max = parseMaxConnections(options.max);
	const idleTimeout = options.idleTimeout ?? 20;
	const connectTimeout = options.connectTimeout ?? 10;
	const maxLifetime = options.maxLifetime ?? 60 * 30;
	const prepare = options.prepare ?? false;
	const ssl = resolveSslOption(databaseUrl, options.ssl);

	return postgres(databaseUrl, {
		connect_timeout: connectTimeout,
		idle_timeout: idleTimeout,
		max,
		max_lifetime: maxLifetime,
		prepare,
		...(ssl === undefined ? {} : { ssl }),
	});
}

export function createDbConnection(
	databaseUrl: string,
	options: DbOptions = {}
): {
	client: postgres.Sql;
	close: () => Promise<void>;
	db: Database;
} {
	const client = buildClient(databaseUrl, options);
	const db = drizzle(client, { schema });
	return {
		client,
		close: async () => {
			await client.end({ timeout: 5 });
		},
		db,
	};
}

export function createDb(
	databaseUrl: string,
	options: DbOptions = {}
): Database {
	return createDbConnection(databaseUrl, options).db;
}

function getDatabaseUrl(): string {
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) {
		if (process.env.NODE_ENV === "production") {
			throw new Error(
				"DATABASE_URL environment variable is required in production"
			);
		}
		return "postgresql://postgres:postgres@localhost:5432/starter_db";
	}
	return databaseUrl;
}

const globalForDb = globalThis as unknown as {
	_postgresClient?: postgres.Sql;
	_db?: Database;
};

export function getDb(): Database {
	if (!globalForDb._db) {
		const databaseUrl = getDatabaseUrl();
		const client = globalForDb._postgresClient ?? buildClient(databaseUrl);
		globalForDb._postgresClient = client;
		globalForDb._db = drizzle(client, { schema });
	}
	return globalForDb._db;
}

export const db = getDb();

export async function closeDb(): Promise<void> {
	if (globalForDb._postgresClient) {
		try {
			await globalForDb._postgresClient.end({ timeout: 5 });
		} finally {
			globalForDb._postgresClient = undefined;
			globalForDb._db = undefined;
		}
	}
}
