import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Keep World Cup results fresh. football-data.org's free tier allows plenty of
// headroom for a pull every 30 minutes.
crons.interval(
  "sync world cup results",
  { minutes: 30 },
  internal.results.syncResults,
  {},
);

// Keep live match odds fresh from odds-api.io. A 30-minute cadence is plenty for
// pre-match lines and stays well within typical odds-feed quotas.
crons.interval(
  "sync world cup odds",
  { minutes: 30 },
  internal.results.syncOdds,
  {},
);

export default crons;
