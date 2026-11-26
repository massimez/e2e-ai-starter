import {
	createRouter,
	createSuccessResponse,
} from "../../../lib/create-hono-app";
import { adminOverviewService } from "./service";

/** Platform overview sub-routes mounted under `/api/admin/overview`. */
export const adminOverviewRoutes = createRouter().get("/", async (c) => {
	const data = await adminOverviewService.getOverview();
	return c.json(createSuccessResponse(data));
});
