import { query, internalMutation, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { POOL } from "./pool";
import { avatarUrls } from "./account";

// ── Team-name mapping ────────────────────────────────────
// football-data.org uses its own spellings; map them onto our pool names so
// match results line up with the teams players actually drew.
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

// Known mismatches between football-data names and our pool names.
const ALIASES: Record<string, string> = {
  unitedstates: "USA",
  usa: "USA",
  korearepublic: "South Korea",
  republicofkorea: "South Korea",
  southkorea: "South Korea",
  cotedivoire: "Ivory Coast",
  ivorycoast: "Ivory Coast",
  drcongo: "DR Congo",
  congodr: "DR Congo",
  democraticrepublicofthecongo: "DR Congo",
  czechrepublic: "Czechia",
  czechia: "Czechia",
  capeverde: "Cape Verde",
  capeverdeislands: "Cape Verde",
  bosniaherzegovina: "Bosnia & Herzegovina",
  bosniaandherzegovina: "Bosnia & Herzegovina",
  curacao: "Curaçao",
};

const POOL_BY_NORM: Record<string, string> = Object.fromEntries(
  POOL.map((t) => [norm(t.name), t.name]),
);
const FLAG_BY_NAME: Record<string, string> = Object.fromEntries(
  POOL.map((t) => [t.name, t.flag]),
);

// Resolve a football-data team name to our canonical pool name, or return the
// raw name if we can't (it simply won't match any drawn team in standings).
function canonicalTeam(name: string): string {
  const n = norm(name);
  return ALIASES[n] ?? POOL_BY_NORM[n] ?? name;
}
function flagFor(canonical: string): string {
  return FLAG_BY_NAME[canonical] ?? "🏳️";
}

// ── Sync: pull World Cup results from football-data.org ──
// Runs on a cron (see crons.ts). No-ops quietly if no API key is configured.
export const syncResults = internalAction({
  args: {},
  handler: async (ctx) => {
    const key = process.env.FOOTBALL_API_KEY;
    if (!key) {
      console.log("FOOTBALL_API_KEY not set - skipping results sync.");
      return;
    }

    const res = await fetch(
      "https://api.football-data.org/v4/competitions/WC/matches",
      { headers: { "X-Auth-Token": key } },
    );
    if (!res.ok) {
      console.error(`football-data sync failed: ${res.status}`);
      return;
    }

    const body = (await res.json()) as {
      matches?: Array<{
        id: number;
        stage: string;
        status: string;
        utcDate: string;
        homeTeam: { name: string | null };
        awayTeam: { name: string | null };
        score: {
          winner: "HOME_TEAM" | "AWAY_TEAM" | "DRAW" | null;
          fullTime: { home: number | null; away: number | null };
        };
      }>;
    };

    // Knockout fixtures arrive with null team names until the bracket fills in;
    // skip those - a later sync will upsert them once the teams are known.
    const all = body.matches ?? [];
    const matches = all
      .filter((m) => m.homeTeam?.name && m.awayTeam?.name)
      .map((m) => ({
        extId: m.id,
        stage: m.stage,
        status: m.status,
        utcDate: m.utcDate,
        homeTeam: canonicalTeam(m.homeTeam.name as string),
        awayTeam: canonicalTeam(m.awayTeam.name as string),
        homeGoals: m.score.fullTime.home ?? undefined,
        awayGoals: m.score.fullTime.away ?? undefined,
        winner:
          m.score.winner === "HOME_TEAM"
            ? ("HOME" as const)
            : m.score.winner === "AWAY_TEAM"
              ? ("AWAY" as const)
              : m.score.winner === "DRAW"
                ? ("DRAW" as const)
                : undefined,
      }));

    await ctx.runMutation(internal.results.upsertMatches, { matches });
    console.log(`Synced ${matches.length}/${all.length} World Cup matches.`);

    // ── Group standings ──
    const stRes = await fetch(
      "https://api.football-data.org/v4/competitions/WC/standings",
      { headers: { "X-Auth-Token": key } },
    );
    if (!stRes.ok) {
      console.error(`football-data standings failed: ${stRes.status}`);
      return;
    }
    const stBody = (await stRes.json()) as {
      standings?: Array<{
        group: string | null;
        table: Array<{
          position: number;
          team: { name: string };
          playedGames: number;
          won: number;
          draw: number;
          lost: number;
          goalsFor: number;
          goalsAgainst: number;
          goalDifference: number;
          points: number;
          form: string | null;
        }>;
      }>;
    };

    const groups = (stBody.standings ?? [])
      .filter((b) => b.group)
      .map((b, i) => ({
        group: b.group as string,
        order: i,
        table: b.table.map((r) => {
          const teamName = canonicalTeam(r.team.name);
          return {
            position: r.position,
            teamName,
            flag: flagFor(teamName),
            played: r.playedGames,
            won: r.won,
            draw: r.draw,
            lost: r.lost,
            goalsFor: r.goalsFor,
            goalsAgainst: r.goalsAgainst,
            goalDifference: r.goalDifference,
            points: r.points,
            form: r.form ?? undefined,
          };
        }),
      }));

    await ctx.runMutation(internal.results.upsertGroupStandings, { groups });
    console.log(`Synced ${groups.length} group standings.`);
  },
});

const matchValidator = v.object({
  extId: v.number(),
  stage: v.string(),
  status: v.string(),
  utcDate: v.string(),
  homeTeam: v.string(),
  awayTeam: v.string(),
  homeGoals: v.optional(v.number()),
  awayGoals: v.optional(v.number()),
  winner: v.optional(
    v.union(v.literal("HOME"), v.literal("AWAY"), v.literal("DRAW")),
  ),
});

export const upsertMatches = internalMutation({
  args: { matches: v.array(matchValidator) },
  handler: async (ctx, { matches }) => {
    for (const m of matches) {
      const existing = await ctx.db
        .query("matches")
        .withIndex("by_ext", (q) => q.eq("extId", m.extId))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, m);
      } else {
        await ctx.db.insert("matches", m);
      }
    }
  },
});

const standingRowValidator = v.object({
  position: v.number(),
  teamName: v.string(),
  flag: v.string(),
  played: v.number(),
  won: v.number(),
  draw: v.number(),
  lost: v.number(),
  goalsFor: v.number(),
  goalsAgainst: v.number(),
  goalDifference: v.number(),
  points: v.number(),
  form: v.optional(v.string()),
});

export const upsertGroupStandings = internalMutation({
  args: {
    groups: v.array(
      v.object({
        group: v.string(),
        order: v.number(),
        table: v.array(standingRowValidator),
      }),
    ),
  },
  handler: async (ctx, { groups }) => {
    for (const g of groups) {
      const existing = await ctx.db
        .query("groupStandings")
        .withIndex("by_group", (q) => q.eq("group", g.group))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, { order: g.order, table: g.table });
      } else {
        await ctx.db.insert("groupStandings", g);
      }
    }
  },
});

// Public: the full set of group tables, ordered A–L, for the Standings page.
export const groups = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("groupStandings").collect();
    rows.sort((a, b) => a.order - b.order);
    return rows.map((r) => ({ group: r.group, table: r.table }));
  },
});

// ── Standings ────────────────────────────────────────────
// 3 pts for a win, 1 for a draw, 0 for a loss. A player's African team scores
// double. Knockouts are settled by the final result, so they're never a draw.
type MatchDoc = {
  status: string;
  homeTeam: string;
  awayTeam: string;
  winner?: "HOME" | "AWAY" | "DRAW";
};

function teamRecord(teamName: string, matches: MatchDoc[]) {
  let played = 0;
  let w = 0;
  let d = 0;
  let l = 0;
  for (const m of matches) {
    if (m.status !== "FINISHED" || !m.winner) continue;
    const isHome = m.homeTeam === teamName;
    const isAway = m.awayTeam === teamName;
    if (!isHome && !isAway) continue;
    played++;
    if (m.winner === "DRAW") d++;
    else if ((m.winner === "HOME" && isHome) || (m.winner === "AWAY" && isAway))
      w++;
    else l++;
  }
  return { played, w, d, l, points: w * 3 + d };
}

export const standings = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!room) return null;

    const players = await ctx.db
      .query("players")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();
    const teams = await ctx.db
      .query("teams")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();
    const matches = await ctx.db.query("matches").collect();
    const avatars = await avatarUrls(
      ctx,
      players.map((p) => p.userId),
    );

    const rows = players.map((p) => {
      const owned = teams
        .filter((t) => t.ownerId === p._id)
        .sort((a, b) => a.tier - b.tier)
        .map((t) => {
          const rec = teamRecord(t.name, matches);
          return { name: t.name, flag: t.flag, tier: t.tier, ...rec };
        });

      const afrRec = p.africanTeam
        ? teamRecord(p.africanTeam.name, matches)
        : null;
      const african = p.africanTeam
        ? {
            name: p.africanTeam.name,
            flag: p.africanTeam.flag,
            ...afrRec!,
            points: afrRec!.points * 2, // double points
          }
        : null;

      const total =
        owned.reduce((s, t) => s + t.points, 0) + (african?.points ?? 0);

      return {
        playerId: p._id,
        userId: p.userId,
        name: p.name,
        avatarUrl: avatars[p.userId] ?? null,
        total,
        teams: owned,
        african,
      };
    });

    rows.sort((a, b) => b.total - a.total);
    return rows;
  },
});
