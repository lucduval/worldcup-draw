// 2026 FIFA World Cup schedule (hosts USA / Canada / Mexico).
// Final draw 5 Dec 2025; full schedule released 6 Dec 2025.
// Kickoffs stored as UTC instants - rendered in SAST (Africa/Johannesburg,
// UTC+2, no DST) by the helpers below. 72 group matches + 32 knockout slots.
import { POOL } from "../convex/pool";

export type Round = "group" | "R32" | "R16" | "QF" | "SF" | "3rd" | "Final";

export type Fixture = {
  round: Round;
  group?: string;
  utc: string;
  venue: string;
  home: string; // team name (group) or bracket-slot label (knockout)
  away: string;
  teamsKnown: boolean; // true once the two teams are decided (group stage)
};

const FLAG = new Map(POOL.map((t) => [t.name, t.flag] as const));
export function flagFor(name: string): string | null {
  return FLAG.get(name) ?? null;
}

export const ROUND_LABEL: Record<Round, string> = {
  group: "Group",
  R32: "Round of 32",
  R16: "Round of 16",
  QF: "Quarter-final",
  SF: "Semi-final",
  "3rd": "Third place",
  Final: "Final",
};

const GROUP_MATCHES: Omit<Fixture, "teamsKnown">[] = [
  { round: "group", group: "A", utc: "2026-06-11T19:00:00Z", venue: "Estadio Azteca, Mexico City", home: "Mexico", away: "South Africa" },
  { round: "group", group: "A", utc: "2026-06-12T02:00:00Z", venue: "Estadio Akron, Guadalajara", home: "South Korea", away: "Czechia" },
  { round: "group", group: "A", utc: "2026-06-18T16:00:00Z", venue: "Mercedes-Benz Stadium, Atlanta", home: "Czechia", away: "South Africa" },
  { round: "group", group: "A", utc: "2026-06-19T01:00:00Z", venue: "Estadio Akron, Guadalajara", home: "Mexico", away: "South Korea" },
  { round: "group", group: "A", utc: "2026-06-25T01:00:00Z", venue: "Estadio Azteca, Mexico City", home: "Czechia", away: "Mexico" },
  { round: "group", group: "A", utc: "2026-06-25T01:00:00Z", venue: "Estadio BBVA, Monterrey", home: "South Africa", away: "South Korea" },

  { round: "group", group: "B", utc: "2026-06-12T19:00:00Z", venue: "BMO Field, Toronto", home: "Canada", away: "Bosnia & Herzegovina" },
  { round: "group", group: "B", utc: "2026-06-13T19:00:00Z", venue: "Levi's Stadium, Santa Clara", home: "Qatar", away: "Switzerland" },
  { round: "group", group: "B", utc: "2026-06-18T19:00:00Z", venue: "SoFi Stadium, Inglewood", home: "Switzerland", away: "Bosnia & Herzegovina" },
  { round: "group", group: "B", utc: "2026-06-18T22:00:00Z", venue: "BC Place, Vancouver", home: "Canada", away: "Qatar" },
  { round: "group", group: "B", utc: "2026-06-24T19:00:00Z", venue: "BC Place, Vancouver", home: "Switzerland", away: "Canada" },
  { round: "group", group: "B", utc: "2026-06-24T19:00:00Z", venue: "Lumen Field, Seattle", home: "Bosnia & Herzegovina", away: "Qatar" },

  { round: "group", group: "C", utc: "2026-06-13T22:00:00Z", venue: "MetLife Stadium, East Rutherford", home: "Brazil", away: "Morocco" },
  { round: "group", group: "C", utc: "2026-06-14T01:00:00Z", venue: "Gillette Stadium, Foxborough", home: "Haiti", away: "Scotland" },
  { round: "group", group: "C", utc: "2026-06-19T22:00:00Z", venue: "Gillette Stadium, Foxborough", home: "Scotland", away: "Morocco" },
  { round: "group", group: "C", utc: "2026-06-20T00:30:00Z", venue: "Lincoln Financial Field, Philadelphia", home: "Brazil", away: "Haiti" },
  { round: "group", group: "C", utc: "2026-06-24T22:00:00Z", venue: "Hard Rock Stadium, Miami", home: "Scotland", away: "Brazil" },
  { round: "group", group: "C", utc: "2026-06-24T22:00:00Z", venue: "Mercedes-Benz Stadium, Atlanta", home: "Morocco", away: "Haiti" },

  { round: "group", group: "D", utc: "2026-06-13T01:00:00Z", venue: "SoFi Stadium, Inglewood", home: "USA", away: "Paraguay" },
  { round: "group", group: "D", utc: "2026-06-14T04:00:00Z", venue: "BC Place, Vancouver", home: "Australia", away: "Turkey" },
  { round: "group", group: "D", utc: "2026-06-19T19:00:00Z", venue: "Lumen Field, Seattle", home: "USA", away: "Australia" },
  { round: "group", group: "D", utc: "2026-06-20T03:00:00Z", venue: "Levi's Stadium, Santa Clara", home: "Turkey", away: "Paraguay" },
  { round: "group", group: "D", utc: "2026-06-26T02:00:00Z", venue: "SoFi Stadium, Inglewood", home: "Turkey", away: "USA" },
  { round: "group", group: "D", utc: "2026-06-26T02:00:00Z", venue: "Levi's Stadium, Santa Clara", home: "Paraguay", away: "Australia" },

  { round: "group", group: "E", utc: "2026-06-14T17:00:00Z", venue: "NRG Stadium, Houston", home: "Germany", away: "Curaçao" },
  { round: "group", group: "E", utc: "2026-06-14T23:00:00Z", venue: "Lincoln Financial Field, Philadelphia", home: "Ivory Coast", away: "Ecuador" },
  { round: "group", group: "E", utc: "2026-06-20T20:00:00Z", venue: "BMO Field, Toronto", home: "Germany", away: "Ivory Coast" },
  { round: "group", group: "E", utc: "2026-06-21T00:00:00Z", venue: "Arrowhead Stadium, Kansas City", home: "Ecuador", away: "Curaçao" },
  { round: "group", group: "E", utc: "2026-06-25T20:00:00Z", venue: "Lincoln Financial Field, Philadelphia", home: "Curaçao", away: "Ivory Coast" },
  { round: "group", group: "E", utc: "2026-06-25T20:00:00Z", venue: "MetLife Stadium, East Rutherford", home: "Ecuador", away: "Germany" },

  { round: "group", group: "F", utc: "2026-06-14T20:00:00Z", venue: "AT&T Stadium, Dallas", home: "Netherlands", away: "Japan" },
  { round: "group", group: "F", utc: "2026-06-15T02:00:00Z", venue: "Estadio BBVA, Monterrey", home: "Sweden", away: "Tunisia" },
  { round: "group", group: "F", utc: "2026-06-20T17:00:00Z", venue: "NRG Stadium, Houston", home: "Netherlands", away: "Sweden" },
  { round: "group", group: "F", utc: "2026-06-21T04:00:00Z", venue: "Estadio BBVA, Monterrey", home: "Tunisia", away: "Japan" },
  { round: "group", group: "F", utc: "2026-06-25T23:00:00Z", venue: "AT&T Stadium, Dallas", home: "Japan", away: "Sweden" },
  { round: "group", group: "F", utc: "2026-06-25T23:00:00Z", venue: "Arrowhead Stadium, Kansas City", home: "Tunisia", away: "Netherlands" },

  { round: "group", group: "G", utc: "2026-06-15T19:00:00Z", venue: "Lumen Field, Seattle", home: "Belgium", away: "Egypt" },
  { round: "group", group: "G", utc: "2026-06-16T01:00:00Z", venue: "SoFi Stadium, Inglewood", home: "Iran", away: "New Zealand" },
  { round: "group", group: "G", utc: "2026-06-21T19:00:00Z", venue: "SoFi Stadium, Inglewood", home: "Belgium", away: "Iran" },
  { round: "group", group: "G", utc: "2026-06-22T01:00:00Z", venue: "BC Place, Vancouver", home: "New Zealand", away: "Egypt" },
  { round: "group", group: "G", utc: "2026-06-27T03:00:00Z", venue: "Lumen Field, Seattle", home: "Egypt", away: "Iran" },
  { round: "group", group: "G", utc: "2026-06-27T03:00:00Z", venue: "BC Place, Vancouver", home: "New Zealand", away: "Belgium" },

  { round: "group", group: "H", utc: "2026-06-15T16:00:00Z", venue: "Mercedes-Benz Stadium, Atlanta", home: "Spain", away: "Cape Verde" },
  { round: "group", group: "H", utc: "2026-06-15T22:00:00Z", venue: "Hard Rock Stadium, Miami", home: "Saudi Arabia", away: "Uruguay" },
  { round: "group", group: "H", utc: "2026-06-21T16:00:00Z", venue: "Mercedes-Benz Stadium, Atlanta", home: "Spain", away: "Saudi Arabia" },
  { round: "group", group: "H", utc: "2026-06-21T22:00:00Z", venue: "Hard Rock Stadium, Miami", home: "Uruguay", away: "Cape Verde" },
  { round: "group", group: "H", utc: "2026-06-27T00:00:00Z", venue: "NRG Stadium, Houston", home: "Cape Verde", away: "Saudi Arabia" },
  { round: "group", group: "H", utc: "2026-06-27T00:00:00Z", venue: "Estadio Akron, Guadalajara", home: "Uruguay", away: "Spain" },

  { round: "group", group: "I", utc: "2026-06-16T19:00:00Z", venue: "MetLife Stadium, East Rutherford", home: "France", away: "Senegal" },
  { round: "group", group: "I", utc: "2026-06-16T22:00:00Z", venue: "Gillette Stadium, Foxborough", home: "Iraq", away: "Norway" },
  { round: "group", group: "I", utc: "2026-06-22T21:00:00Z", venue: "Lincoln Financial Field, Philadelphia", home: "France", away: "Iraq" },
  { round: "group", group: "I", utc: "2026-06-23T00:00:00Z", venue: "MetLife Stadium, East Rutherford", home: "Norway", away: "Senegal" },
  { round: "group", group: "I", utc: "2026-06-26T19:00:00Z", venue: "Gillette Stadium, Foxborough", home: "Norway", away: "France" },
  { round: "group", group: "I", utc: "2026-06-26T19:00:00Z", venue: "BMO Field, Toronto", home: "Senegal", away: "Iraq" },

  { round: "group", group: "J", utc: "2026-06-17T01:00:00Z", venue: "Arrowhead Stadium, Kansas City", home: "Argentina", away: "Algeria" },
  { round: "group", group: "J", utc: "2026-06-17T04:00:00Z", venue: "Levi's Stadium, Santa Clara", home: "Austria", away: "Jordan" },
  { round: "group", group: "J", utc: "2026-06-22T17:00:00Z", venue: "AT&T Stadium, Dallas", home: "Argentina", away: "Austria" },
  { round: "group", group: "J", utc: "2026-06-23T03:00:00Z", venue: "Levi's Stadium, Santa Clara", home: "Jordan", away: "Algeria" },
  { round: "group", group: "J", utc: "2026-06-28T02:00:00Z", venue: "Arrowhead Stadium, Kansas City", home: "Algeria", away: "Austria" },
  { round: "group", group: "J", utc: "2026-06-28T02:00:00Z", venue: "AT&T Stadium, Dallas", home: "Jordan", away: "Argentina" },

  { round: "group", group: "K", utc: "2026-06-17T17:00:00Z", venue: "NRG Stadium, Houston", home: "Portugal", away: "DR Congo" },
  { round: "group", group: "K", utc: "2026-06-18T02:00:00Z", venue: "Estadio Azteca, Mexico City", home: "Uzbekistan", away: "Colombia" },
  { round: "group", group: "K", utc: "2026-06-23T17:00:00Z", venue: "NRG Stadium, Houston", home: "Portugal", away: "Uzbekistan" },
  { round: "group", group: "K", utc: "2026-06-24T02:00:00Z", venue: "Estadio Akron, Guadalajara", home: "Colombia", away: "DR Congo" },
  { round: "group", group: "K", utc: "2026-06-27T23:30:00Z", venue: "Hard Rock Stadium, Miami", home: "Colombia", away: "Portugal" },
  { round: "group", group: "K", utc: "2026-06-27T23:30:00Z", venue: "Mercedes-Benz Stadium, Atlanta", home: "DR Congo", away: "Uzbekistan" },

  { round: "group", group: "L", utc: "2026-06-17T20:00:00Z", venue: "AT&T Stadium, Dallas", home: "England", away: "Croatia" },
  { round: "group", group: "L", utc: "2026-06-17T23:00:00Z", venue: "BMO Field, Toronto", home: "Ghana", away: "Panama" },
  { round: "group", group: "L", utc: "2026-06-23T20:00:00Z", venue: "Gillette Stadium, Foxborough", home: "England", away: "Ghana" },
  { round: "group", group: "L", utc: "2026-06-23T23:00:00Z", venue: "BMO Field, Toronto", home: "Panama", away: "Croatia" },
  { round: "group", group: "L", utc: "2026-06-27T21:00:00Z", venue: "MetLife Stadium, East Rutherford", home: "Panama", away: "England" },
  { round: "group", group: "L", utc: "2026-06-27T21:00:00Z", venue: "Lincoln Financial Field, Philadelphia", home: "Croatia", away: "Ghana" },
];

// Knockout slots - teams decided by group results, so home/away are bracket labels.
const KO: { round: Round; utc: string; venue: string; label: string }[] = [
  { round: "R32", utc: "2026-06-28T19:00:00Z", venue: "SoFi Stadium, Inglewood", label: "2A vs 2B" },
  { round: "R32", utc: "2026-06-29T20:30:00Z", venue: "Gillette Stadium, Foxborough", label: "1E vs 3(A/B/C/D/F)" },
  { round: "R32", utc: "2026-06-30T01:00:00Z", venue: "Estadio BBVA, Monterrey", label: "1F vs 2C" },
  { round: "R32", utc: "2026-06-29T17:00:00Z", venue: "NRG Stadium, Houston", label: "1C vs 2F" },
  { round: "R32", utc: "2026-06-30T21:00:00Z", venue: "MetLife Stadium, East Rutherford", label: "1I vs 3(C/D/F/G/H)" },
  { round: "R32", utc: "2026-06-30T17:00:00Z", venue: "AT&T Stadium, Dallas", label: "2E vs 2I" },
  { round: "R32", utc: "2026-07-01T01:00:00Z", venue: "Estadio Azteca, Mexico City", label: "1A vs 3(C/E/F/H/I)" },
  { round: "R32", utc: "2026-07-01T16:00:00Z", venue: "Mercedes-Benz Stadium, Atlanta", label: "1L vs 3(E/H/I/J/K)" },
  { round: "R32", utc: "2026-07-02T00:00:00Z", venue: "Levi's Stadium, Santa Clara", label: "1D vs 3(B/E/F/I/J)" },
  { round: "R32", utc: "2026-07-01T20:00:00Z", venue: "Lumen Field, Seattle", label: "1G vs 3(A/E/H/I/J)" },
  { round: "R32", utc: "2026-07-02T23:00:00Z", venue: "BMO Field, Toronto", label: "2K vs 2L" },
  { round: "R32", utc: "2026-07-02T19:00:00Z", venue: "SoFi Stadium, Inglewood", label: "1H vs 2J" },
  { round: "R32", utc: "2026-07-03T03:00:00Z", venue: "BC Place, Vancouver", label: "1B vs 3(E/F/G/I/J)" },
  { round: "R32", utc: "2026-07-03T22:00:00Z", venue: "Hard Rock Stadium, Miami", label: "1J vs 2H" },
  { round: "R32", utc: "2026-07-04T01:30:00Z", venue: "Arrowhead Stadium, Kansas City", label: "1K vs 3(D/E/I/J/L)" },
  { round: "R32", utc: "2026-07-03T18:00:00Z", venue: "AT&T Stadium, Dallas", label: "2D vs 2G" },
  { round: "R16", utc: "2026-07-04T21:00:00Z", venue: "Lincoln Financial Field, Philadelphia", label: "W74 vs W77" },
  { round: "R16", utc: "2026-07-04T17:00:00Z", venue: "NRG Stadium, Houston", label: "W73 vs W75" },
  { round: "R16", utc: "2026-07-05T20:00:00Z", venue: "MetLife Stadium, East Rutherford", label: "W76 vs W78" },
  { round: "R16", utc: "2026-07-06T00:00:00Z", venue: "Estadio Azteca, Mexico City", label: "W79 vs W80" },
  { round: "R16", utc: "2026-07-06T19:00:00Z", venue: "AT&T Stadium, Dallas", label: "W83 vs W84" },
  { round: "R16", utc: "2026-07-07T00:00:00Z", venue: "Lumen Field, Seattle", label: "W81 vs W82" },
  { round: "R16", utc: "2026-07-07T16:00:00Z", venue: "Mercedes-Benz Stadium, Atlanta", label: "W86 vs W88" },
  { round: "R16", utc: "2026-07-07T20:00:00Z", venue: "BC Place, Vancouver", label: "W85 vs W87" },
  { round: "QF", utc: "2026-07-09T20:00:00Z", venue: "Gillette Stadium, Foxborough", label: "W89 vs W90" },
  { round: "QF", utc: "2026-07-10T19:00:00Z", venue: "SoFi Stadium, Inglewood", label: "W93 vs W94" },
  { round: "QF", utc: "2026-07-11T21:00:00Z", venue: "Hard Rock Stadium, Miami", label: "W91 vs W92" },
  { round: "QF", utc: "2026-07-12T01:00:00Z", venue: "Arrowhead Stadium, Kansas City", label: "W95 vs W96" },
  { round: "SF", utc: "2026-07-14T19:00:00Z", venue: "AT&T Stadium, Dallas", label: "W97 vs W98" },
  { round: "SF", utc: "2026-07-15T19:00:00Z", venue: "Mercedes-Benz Stadium, Atlanta", label: "W99 vs W100" },
  { round: "3rd", utc: "2026-07-18T21:00:00Z", venue: "Hard Rock Stadium, Miami", label: "Loser SF1 vs Loser SF2" },
  { round: "Final", utc: "2026-07-19T19:00:00Z", venue: "MetLife Stadium, East Rutherford", label: "Winner SF1 vs Winner SF2" },
];

export const FIXTURES: Fixture[] = [
  ...GROUP_MATCHES.map((m) => ({ ...m, teamsKnown: true })),
  ...KO.map((k) => {
    const [home, away] = k.label.split(" vs ");
    return {
      round: k.round,
      utc: k.utc,
      venue: k.venue,
      home,
      away,
      teamsKnown: false,
    };
  }),
].sort((a, b) => a.utc.localeCompare(b.utc));

const SAST = "Africa/Johannesburg";
const dateFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: SAST,
  weekday: "short",
  day: "2-digit",
  month: "short",
});
const timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: SAST,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function sastDate(utc: string): string {
  return dateFmt.format(new Date(utc));
}
export function sastTime(utc: string): string {
  return timeFmt.format(new Date(utc));
}

// A match is "upcoming" until ~2h after kickoff (so in-progress games still show).
const LIVE_WINDOW_MS = 2 * 60 * 60 * 1000;
export function isUpcoming(utc: string, now: number): boolean {
  return new Date(utc).getTime() + LIVE_WINDOW_MS >= now;
}
export function involves(f: Fixture, teams: Set<string>): boolean {
  return f.teamsKnown && (teams.has(f.home) || teams.has(f.away));
}

// A knockout pairing resolved from the live feed, keyed by kickoff instant.
export type ResolvedPairing = { home: string; away: string };

// Overlay decided knockout teams onto the static bracket. The static schedule
// owns kickoff time, venue and round; the live feed owns who's actually playing
// once the draw fills in. We join on the kickoff instant (utc) - knockout games
// never start simultaneously, so it's a unique key - and only touch fixtures
// whose teams aren't known yet (the group stage already carries real teams).
// Home/away orientation follows the feed, which can differ from the slot label.
// A round that hasn't been drawn yet simply has no entry and keeps its label.
export function resolveFixtures(byUtc: Map<string, ResolvedPairing>): Fixture[] {
  if (byUtc.size === 0) return FIXTURES;
  return FIXTURES.map((f) => {
    if (f.teamsKnown) return f;
    const live = byUtc.get(f.utc);
    if (!live) return f;
    return { ...f, home: live.home, away: live.away, teamsKnown: true };
  });
}
