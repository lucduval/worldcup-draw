// Single source of truth shared by the Convex backend AND the React client.
// 48 nations, three tiers of 16. Edit freely - flags are emoji.

// How long a tier draw stays on screen: the reel spins, lands on the drawn
// flag, then holds on it so everyone sees who got what before the next turn.
export const REVEAL_MS = 3200;

// Async "watch anytime" replay timing (client-side only - the async draw has no
// shared reveal clock). Other players' picks auto-reveal quickly; the watcher's
// own reveal dwells noticeably longer than the live draw, since that's the
// moment that actually matters.
export const ASYNC_OTHERS_MS = 1100; // quick auto-reveal of other players' picks
export const ASYNC_MINE_MS = 5000; // suspenseful dwell on the watcher's own reveal

export const MAX_PLAYERS = 16; // one team per tier per player, 16 teams per tier
export const ENTRY_FEE = 100; // R100 buy-in

export type PoolTeam = { name: string; flag: string; tier: number };

// The confirmed 48-team field for the 2026 World Cup (USA / Canada / Mexico).
// ORDER IS LOAD-BEARING: the array index is each team's global ranking, used to
// split the field into tiers and to trim it to the player count (see RANK_BY_NAME
// and tierForRank). Ordered by the official FIFA/Coca-Cola Men's World Ranking
// (April 2026) with non-qualifiers removed - so e.g. Italy (#12) and Denmark
// (#20) don't appear. The lowest ~11 teams sit below FIFA #50, where the public
// ranking is noisy, so their order among themselves is best-effort; all land in
// Tier 3 / the cut zone regardless. Iraq and DR Congo came through the
// intercontinental playoffs; Cape Verde, Curaçao, Jordan and Uzbekistan debut.
// Re-rank here whenever FIFA publishes an update.
export const POOL: PoolTeam[] = [
  // ── Tier 1 (FIFA #1–16, qualified) ──────────────────────
  { name: "France", flag: "🇫🇷", tier: 1 },
  { name: "Spain", flag: "🇪🇸", tier: 1 },
  { name: "Argentina", flag: "🇦🇷", tier: 1 },
  { name: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", tier: 1 },
  { name: "Portugal", flag: "🇵🇹", tier: 1 },
  { name: "Brazil", flag: "🇧🇷", tier: 1 },
  { name: "Netherlands", flag: "🇳🇱", tier: 1 },
  { name: "Morocco", flag: "🇲🇦", tier: 1 },
  { name: "Belgium", flag: "🇧🇪", tier: 1 },
  { name: "Germany", flag: "🇩🇪", tier: 1 },
  { name: "Croatia", flag: "🇭🇷", tier: 1 },
  { name: "Colombia", flag: "🇨🇴", tier: 1 },
  { name: "Senegal", flag: "🇸🇳", tier: 1 },
  { name: "Mexico", flag: "🇲🇽", tier: 1 },
  { name: "USA", flag: "🇺🇸", tier: 1 },
  { name: "Uruguay", flag: "🇺🇾", tier: 1 },

  // ── Tier 2 (FIFA #17–32, qualified) ─────────────────────
  { name: "Japan", flag: "🇯🇵", tier: 2 },
  { name: "Switzerland", flag: "🇨🇭", tier: 2 },
  { name: "Iran", flag: "🇮🇷", tier: 2 },
  { name: "Turkey", flag: "🇹🇷", tier: 2 },
  { name: "Ecuador", flag: "🇪🇨", tier: 2 },
  { name: "Austria", flag: "🇦🇹", tier: 2 },
  { name: "South Korea", flag: "🇰🇷", tier: 2 },
  { name: "Australia", flag: "🇦🇺", tier: 2 },
  { name: "Algeria", flag: "🇩🇿", tier: 2 },
  { name: "Egypt", flag: "🇪🇬", tier: 2 },
  { name: "Canada", flag: "🇨🇦", tier: 2 },
  { name: "Norway", flag: "🇳🇴", tier: 2 },
  { name: "Panama", flag: "🇵🇦", tier: 2 },
  { name: "Ivory Coast", flag: "🇨🇮", tier: 2 },
  { name: "Sweden", flag: "🇸🇪", tier: 2 },
  { name: "Paraguay", flag: "🇵🇾", tier: 2 },

  // ── Tier 3 (FIFA #33+, qualified; tail best-effort) ─────
  { name: "Czechia", flag: "🇨🇿", tier: 3 },
  { name: "Scotland", flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", tier: 3 },
  { name: "Tunisia", flag: "🇹🇳", tier: 3 },
  { name: "DR Congo", flag: "🇨🇩", tier: 3 },
  { name: "Uzbekistan", flag: "🇺🇿", tier: 3 },
  { name: "Qatar", flag: "🇶🇦", tier: 3 },
  { name: "Saudi Arabia", flag: "🇸🇦", tier: 3 },
  { name: "South Africa", flag: "🇿🇦", tier: 3 },
  { name: "Iraq", flag: "🇮🇶", tier: 3 },
  { name: "Jordan", flag: "🇯🇴", tier: 3 },
  { name: "Ghana", flag: "🇬🇭", tier: 3 },
  { name: "Cape Verde", flag: "🇨🇻", tier: 3 },
  { name: "Curaçao", flag: "🇨🇼", tier: 3 },
  { name: "Haiti", flag: "🇭🇹", tier: 3 },
  { name: "New Zealand", flag: "🇳🇿", tier: 3 },
  { name: "Bosnia & Herzegovina", flag: "🇧🇦", tier: 3 },
];

export const TIERS = 3;

// Global ranking is simply the POOL array order: Tier-1 best-first, then Tier 2,
// then Tier 3. We use it to trim and re-seed the field to the player count.
export const RANK_BY_NAME: Record<string, number> = Object.fromEntries(
  POOL.map((t, i) => [t.name, i]),
);

// Teams left out of a draw are parked in this sentinel tier.
export const CUT_TIER = 0;

// Which tier a globally-ranked team lands in for a draw of `playerCount`
// players. Every player gets exactly one team per tier, so we keep only the top
// `TIERS × playerCount` teams and split them into equal tiers of `playerCount`:
//   n players → ranks [0,n) = Tier 1, [n,2n) = Tier 2, [2n,3n) = Tier 3.
// Anything ranked below the cutoff is dropped from the draw (CUT_TIER). With a
// full 16 players this reproduces the original 16/16/16 tiers exactly.
export function tierForRank(rank: number, playerCount: number): number {
  if (rank >= playerCount * TIERS) return CUT_TIER;
  return Math.floor(rank / playerCount) + 1;
}

// The African nations inside the 48-team pool. Every player freely chooses one
// of these as a bonus team (off the draw clock - anyone can pick on entry, and
// duplicates across players are allowed), so this list is always fully
// available regardless of the main draw.
export const AFRICAN_NAMES = [
  "Morocco",
  "Senegal",
  "Egypt",
  "Algeria",
  "Ivory Coast",
  "Tunisia",
  "South Africa",
  "DR Congo",
  "Ghana",
  "Cape Verde",
];
export const AFRICAN_POOL: PoolTeam[] = POOL.filter((t) =>
  AFRICAN_NAMES.includes(t.name),
);
