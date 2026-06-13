import { query, internalMutation, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { Id, Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { POOL, devig } from "./pool";
import { computeBankroll } from "./betting";
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

// ── Sync: pull live match odds from odds-api.io ──────────
// Runs on a cron (see crons.ts). Lists the World Cup league, pulls the 1X2 (ML)
// market for upcoming fixtures, averages across bookmakers, de-vigs to fair
// odds, and stores them on the matching `matches` row (matched by canonical team
// names + kickoff date, since the two feeds use different ids). No-ops quietly
// without ODDS_API_KEY; any fixture left unpriced falls back to the rank model.
const ODDS_API_BASE = "https://api.odds-api.io/v3";
// odds-api.io requires an explicit bookmakers list and the current plan caps the
// selection at these two. Odds are averaged across whichever of them priced a
// fixture; widen this if the plan's allowed bookmakers change.
const ODDS_BOOKMAKERS = "Bet365,Unibet";

type MlLine = { home: string; draw?: string; away?: string };
type OddsEvent = {
  id: number;
  home: string;
  away: string;
  date: string;
  bookmakers?: Record<
    string,
    Array<{ name: string; updatedAt?: string; odds?: MlLine[] }>
  >;
};

// Average the ML (match-result) line across every bookmaker that priced it.
// Returns null when no bookmaker exposed a usable home/away pair.
function averageMl(
  bookmakers: OddsEvent["bookmakers"],
): { home: number; draw?: number; away: number; updatedAt: number } | null {
  if (!bookmakers) return null;
  let homeSum = 0,
    awaySum = 0,
    drawSum = 0,
    n = 0,
    drawN = 0,
    latest = 0;
  for (const lines of Object.values(bookmakers)) {
    const ml = lines.find((l) => l.name === "ML");
    const line = ml?.odds?.[0];
    if (!line) continue;
    const home = Number(line.home);
    const away = Number(line.away);
    if (!(home > 1) || !(away > 1)) continue;
    homeSum += home;
    awaySum += away;
    n += 1;
    const draw = Number(line.draw);
    if (draw > 1) {
      drawSum += draw;
      drawN += 1;
    }
    const ts = ml?.updatedAt ? Date.parse(ml.updatedAt) : NaN;
    if (Number.isFinite(ts) && ts > latest) latest = ts;
  }
  if (n === 0) return null;
  return {
    home: homeSum / n,
    away: awaySum / n,
    draw: drawN > 0 ? drawSum / drawN : undefined,
    updatedAt: latest,
  };
}

export const syncOdds = internalAction({
  args: {},
  handler: async (ctx) => {
    const key = process.env.ODDS_API_KEY;
    if (!key) {
      console.log("ODDS_API_KEY not set - skipping odds sync.");
      return;
    }

    // 1. Find the World Cup league slug (exclude qualifiers, women's, youth).
    const lgRes = await fetch(
      `${ODDS_API_BASE}/leagues?apiKey=${key}&sport=football`,
    );
    if (!lgRes.ok) {
      console.error(`odds-api leagues failed: ${lgRes.status}`);
      return;
    }
    const leagues = (await lgRes.json()) as Array<{
      name: string;
      slug: string;
      eventsCount?: number;
    }>;
    const wc = leagues
      .filter((l) => {
        const n = l.name.toLowerCase();
        return (
          n.includes("world cup") &&
          !n.includes("qualif") &&
          !n.includes("women") &&
          !/\bu-?\d/.test(n) &&
          !n.includes("club")
        );
      })
      .sort((a, b) => (b.eventsCount ?? 0) - (a.eventsCount ?? 0))[0];
    if (!wc) {
      console.log("odds-api: no World Cup league found - skipping odds sync.");
      return;
    }

    // 2. List upcoming fixtures for that league (defaults to the next 14 days).
    const evRes = await fetch(
      `${ODDS_API_BASE}/events?apiKey=${key}&sport=football&league=${wc.slug}`,
    );
    if (!evRes.ok) {
      console.error(`odds-api events failed: ${evRes.status}`);
      return;
    }
    const events = (await evRes.json()) as OddsEvent[];
    if (events.length === 0) {
      console.log(`odds-api: no upcoming ${wc.slug} fixtures.`);
      return;
    }

    // 3. Pull odds in batches of 10 (the multi endpoint counts as one request),
    //    average + de-vig each, and shape a row keyed by canonical names + date.
    const rows: Array<{
      homeTeam: string;
      awayTeam: string;
      date: string;
      oddsHome: number;
      oddsDraw?: number;
      oddsAway: number;
      oddsUpdatedAt: number;
    }> = [];
    for (let i = 0; i < events.length; i += 10) {
      const batch = events.slice(i, i + 10);
      const ids = batch.map((e) => e.id).join(",");
      const oddsRes = await fetch(
        `${ODDS_API_BASE}/odds/multi?apiKey=${key}&eventIds=${ids}&bookmakers=${ODDS_BOOKMAKERS}`,
      );
      if (!oddsRes.ok) {
        console.error(`odds-api odds failed: ${oddsRes.status}`);
        continue;
      }
      const body = (await oddsRes.json()) as unknown;
      const priced: OddsEvent[] = Array.isArray(body)
        ? (body as OddsEvent[])
        : (((body as { events?: OddsEvent[]; data?: OddsEvent[] }).events ??
            (body as { data?: OddsEvent[] }).data ??
            [body as OddsEvent]) as OddsEvent[]);
      for (const ev of priced) {
        const avg = averageMl(ev.bookmakers);
        if (!avg) continue;
        const fair = devig({ home: avg.home, draw: avg.draw, away: avg.away });
        rows.push({
          homeTeam: canonicalTeam(ev.home),
          awayTeam: canonicalTeam(ev.away),
          date: ev.date,
          oddsHome: fair.home,
          oddsDraw: fair.draw,
          oddsAway: fair.away,
          oddsUpdatedAt: avg.updatedAt,
        });
      }
    }

    await ctx.runMutation(internal.results.upsertOdds, { rows });
    console.log(`Synced odds for ${rows.length}/${events.length} fixtures.`);
  },
});

const oddsRowValidator = v.object({
  homeTeam: v.string(),
  awayTeam: v.string(),
  date: v.string(),
  oddsHome: v.number(),
  oddsDraw: v.optional(v.number()),
  oddsAway: v.number(),
  oddsUpdatedAt: v.number(),
});

// Patch fair odds onto the matching `matches` row. The two feeds share no id, so
// we match on canonical team names + same UTC calendar day (a pairing is unique
// within a day). Fixtures we can't match are simply skipped (model fallback).
export const upsertOdds = internalMutation({
  args: { rows: v.array(oddsRowValidator) },
  handler: async (ctx, { rows }) => {
    const matches = await ctx.db.query("matches").collect();
    const dayOf = (iso: string) => iso.slice(0, 10); // YYYY-MM-DD
    let patched = 0;
    for (const r of rows) {
      const m = matches.find(
        (x) =>
          x.homeTeam === r.homeTeam &&
          x.awayTeam === r.awayTeam &&
          dayOf(x.utcDate) === dayOf(r.date),
      );
      if (!m) continue;
      await ctx.db.patch(m._id, {
        oddsHome: r.oddsHome,
        oddsDraw: r.oddsDraw,
        oddsAway: r.oddsAway,
        oddsUpdatedAt: r.oddsUpdatedAt,
      });
      patched += 1;
    }
    console.log(`Odds upsert: matched ${patched}/${rows.length} fixtures.`);
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

// Map football-data stage codes to friendly labels for the Results page.
const STAGE_LABEL: Record<string, string> = {
  GROUP_STAGE: "Group stage",
  LAST_16: "Round of 16",
  ROUND_OF_16: "Round of 16",
  QUARTER_FINALS: "Quarter-final",
  SEMI_FINALS: "Semi-final",
  THIRD_PLACE: "Third place",
  FINAL: "Final",
};
function stageLabel(stage: string): string {
  return STAGE_LABEL[stage] ?? "Match";
}

// Public: matches that have kicked off (live or finished), newest first, for the
// Results page. Scheduled fixtures live on the Fixtures page, so we drop them.
export const recentMatches = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("matches").collect();
    const played = all.filter((m) => m.status !== "SCHEDULED" && m.status !== "TIMED");
    played.sort((a, b) => b.utcDate.localeCompare(a.utcDate));
    return played.map((m) => ({
      id: m.extId,
      stage: stageLabel(m.stage),
      status: m.status,
      live: m.status === "IN_PLAY" || m.status === "PAUSED",
      utcDate: m.utcDate,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      homeFlag: flagFor(m.homeTeam),
      awayFlag: flagFor(m.awayTeam),
      homeGoals: m.homeGoals ?? null,
      awayGoals: m.awayGoals ?? null,
      winner: m.winner ?? null,
    }));
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

    // Identify the viewer so each player's private betting posture (pending
    // stakes / settled P&L) is only ever returned on their own row.
    const viewerId = await getAuthUserId(ctx);

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

    // Betting layer: when a starting pot is set, each player's bankroll is
    // derived from their bets + the matches table and folds into their total.
    // Pot 0 (or undefined) ⇒ no bankroll, behaviour identical to before.
    const startingPot = room.startingPot ?? 0;
    const bettingOn = startingPot > 0;
    const matchByExtId = new Map(matches.map((m) => [m.extId, m]));
    const betsByPlayer = new Map<Id<"players">, Doc<"bets">[]>();
    if (bettingOn) {
      const bets = await ctx.db
        .query("bets")
        .withIndex("by_room", (q) => q.eq("roomId", room._id))
        .collect();
      for (const b of bets) {
        const list = betsByPlayer.get(b.playerId);
        if (list) list.push(b);
        else betsByPlayer.set(b.playerId, [b]);
      }
    }

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

      const drawTotal =
        owned.reduce((s, t) => s + t.points, 0) + (african?.points ?? 0);

      // Fold the player's bankroll into the score. computeBankroll already
      // floors at 0, so a cold betting run never drags a player below their pure
      // draw score.
      const bank = bettingOn
        ? computeBankroll(
            startingPot,
            betsByPlayer.get(p._id) ?? [],
            matchByExtId,
          )
        : null;
      const bankroll = bank?.bankroll ?? 0;
      const total = drawTotal + bankroll;
      // `bankroll`/`total` are public (the combined leaderboard), but a player's
      // pending stakes and settled P&L reveal their betting posture, so only
      // surface them on the viewer's own row - preserving the private-read edge.
      const isMe = viewerId != null && p.userId === viewerId;

      return {
        playerId: p._id,
        userId: p.userId,
        name: p.name,
        avatarUrl: avatars[p.userId] ?? null,
        total,
        drawTotal,
        bettingOn,
        bankroll,
        pendingStakes: isMe ? (bank?.pendingStakes ?? 0) : 0,
        settledNet: isMe ? (bank?.settledNet ?? 0) : 0,
        teams: owned,
        african,
      };
    });

    rows.sort((a, b) => b.total - a.total);
    return rows;
  },
});
