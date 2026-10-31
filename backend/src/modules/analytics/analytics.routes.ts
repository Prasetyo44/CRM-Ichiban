// GET /api/analytics/overview?from=ISO&to=ISO  (default: 30 hari terakhir)
import { Router } from "express";
import { z } from "zod";
import { currentUser } from "../../lib/auth";
import { HttpError } from "../../lib/http-error";
import { getAnalyticsOverview } from "./analytics.service";

/** Dipasang di server.ts di belakang middleware `requireAgent`. */
export const analyticsRouter = Router();

const MAX_RANGE_DAYS = 366;

analyticsRouter.get("/analytics/overview", async (req, res) => {
  const q = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }).parse(req.query);
  const to = q.to ?? new Date();
  const from = q.from ?? new Date(to.getTime() - 30 * 24 * 3600_000);
  if (from >= to) throw new HttpError(400, "`from` harus sebelum `to`");
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 24 * 3600_000) {
    throw new HttpError(400, `Rentang maksimal ${MAX_RANGE_DAYS} hari`);
  }
  res.json(await getAnalyticsOverview(currentUser(res), { from, to }));
});
