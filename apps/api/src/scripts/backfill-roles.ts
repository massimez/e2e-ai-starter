import { closeDb, db } from "@workspace/db";
import { organization } from "@workspace/db/schema";
import { ensureDefaultOrganizationRoles } from "../modules/roles/service";

async function main() {
	const orgs = await db.select({ id: organization.id }).from(organization);
	console.log(`Backfilling default roles for ${orgs.length} organizations...`);

	await Promise.all(orgs.map((org) => ensureDefaultOrganizationRoles(org.id)));

	console.log("Role backfill completed.");
}

main()
	.catch((error) => {
		console.error("Role backfill failed:", error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await closeDb();
	});
