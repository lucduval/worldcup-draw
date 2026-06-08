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

export default crons;
