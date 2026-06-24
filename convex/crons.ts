import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Keep World Cup results fresh. football-data.org's free tier allows 10
// requests/minute; each run spends 2 (matches + standings), so a once-a-minute
// pull stays well inside the limit while keeping live scores as fresh as the
// free tier permits.
crons.interval(
  "sync world cup results",
  { minutes: 1 },
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
