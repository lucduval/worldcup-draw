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

// Live-draw turn timer (host-toggled). When on, each player has this long to
// tap their pick; if the clock runs out the server draws a team for them and
// moves on. The host chooses a length from these presets; 1 min is the default.
export const TIMER_PRESETS = [30, 60, 120, 300] as const; // seconds
export const DEFAULT_TIMER_SECONDS = 60;

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

// ── Betting odds model ───────────────────────────────────────────────────────
// A per-room bankroll lets players bet on real match outcomes; winnings fold
// into their room score (see convex/betting.ts). These constants + helpers are
// the single source of truth for pricing a bet, shared by the backend (which
// snapshots odds at placement) and surfaced to the client for display.
export const STARTING_POT_DEFAULT = 30; // new-room default bankroll
export const STARTING_POT_MAX = 100; // host-set ceiling (0 = betting off)
export const ODDS_MIN = 1.05; // floor: a heavy favourite still returns a sliver
export const ODDS_MAX = 8; // cap: keep longshots sane
export const DRAW_BASE = 0.27; // peak draw probability for an even group match

// Win-share of `team` vs `opp` from the rank gap (Elo-style logistic). Ranks are
// POOL indices (0 = best), so a lower rank than the opponent gives a share > 0.5.
function winShare(teamRank: number, oppRank: number): number {
  return 1 / (1 + Math.pow(10, (teamRank - oppRank) / 10));
}

// Fair decimal odds for a probability, clamped to [ODDS_MIN, ODDS_MAX]. EV-neutral
// (no house edge): a stake of S on probability p returns ~S/p on average.
export function fairOdds(p: number): number {
  return Math.max(ODDS_MIN, Math.min(ODDS_MAX, 1 / p));
}

// 1X2 probabilities for a GROUP match (home perspective), summing to 1. The draw
// share peaks for an even match and shrinks as the gap widens.
function groupProbs(homeRank: number, awayRank: number) {
  const pa = winShare(homeRank, awayRank); // home "better share"
  const pDraw = DRAW_BASE * (1 - Math.abs(2 * pa - 1)); // peaks when even
  const pHome = Math.max(0, pa - pDraw / 2);
  const pAway = Math.max(0, 1 - pa - pDraw / 2);
  const s = pHome + pAway + pDraw;
  return { pHome: pHome / s, pAway: pAway / s, pDraw: pDraw / s };
}

// 2-way probabilities for a KNOCKOUT match (decided after ET/penalties, so no
// draw outcome exists).
function koProbs(homeRank: number, awayRank: number) {
  const pHome = winShare(homeRank, awayRank);
  return { pHome, pAway: 1 - pHome };
}

// The outcomes a player can bet on for a match.
export type BetPick = "HOME" | "DRAW" | "AWAY";

// Decimal odds per available outcome for a match, given both teams' POOL ranks.
// Group matches expose HOME/DRAW/AWAY; knockouts expose only HOME/AWAY. Callers
// detect knockout via `stage !== "GROUP_STAGE"`.
export function matchOdds(
  homeRank: number,
  awayRank: number,
  isKnockout: boolean,
): { HOME: number; AWAY: number; DRAW?: number } {
  if (isKnockout) {
    const { pHome, pAway } = koProbs(homeRank, awayRank);
    return { HOME: fairOdds(pHome), AWAY: fairOdds(pAway) };
  }
  const { pHome, pAway, pDraw } = groupProbs(homeRank, awayRank);
  return { HOME: fairOdds(pHome), AWAY: fairOdds(pAway), DRAW: fairOdds(pDraw) };
}

// Per-outcome odds built from live market odds (already de-vigged to fair
// decimal odds upstream in the sync). Mirrors `matchOdds`'s shape so betting can
// swap sources transparently. Real market odds are used uncapped (no ODDS_MIN/MAX
// clamp). For a knockout we only price HOME/AWAY, so the draw is dropped and the
// two sides are renormalised to a fair 2-way line (1/p, p re-summed without draw).
export function apiMatchOdds(
  fair: { home: number; draw?: number; away: number },
  isKnockout: boolean,
): { HOME: number; AWAY: number; DRAW?: number } {
  if (isKnockout) {
    const pHome = 1 / fair.home;
    const pAway = 1 / fair.away;
    const s = pHome + pAway;
    return { HOME: s / pHome, AWAY: s / pAway };
  }
  return { HOME: fair.home, AWAY: fair.away, DRAW: fair.draw };
}

// De-vig an averaged 1X2 market into fair decimal odds. Strips the bookmaker
// margin (the implied probabilities sum to >1) so betting stays EV-neutral, then
// returns 1/p per outcome. `draw` is optional — omit for a 2-way market.
export function devig(
  avg: { home: number; draw?: number; away: number },
): { home: number; draw?: number; away: number } {
  const pHome = 1 / avg.home;
  const pAway = 1 / avg.away;
  const pDraw = avg.draw != null ? 1 / avg.draw : 0;
  const overround = pHome + pAway + pDraw;
  if (!(overround > 0)) return avg; // degenerate input ⇒ pass through
  return {
    home: overround / pHome,
    away: overround / pAway,
    draw: avg.draw != null ? overround / pDraw : undefined,
  };
}

// Clamp a host-chosen starting pot to a whole number in [0, STARTING_POT_MAX].
export function clampStartingPot(pot: number | undefined): number {
  if (pot == null || !Number.isFinite(pot)) return STARTING_POT_DEFAULT;
  return Math.min(STARTING_POT_MAX, Math.max(0, Math.round(pot)));
}

// ── Coin re-buy cap ──────────────────────────────────────────────────────────
// A player can buy more coins mid-tournament (1 coin = R1, settled offline).
// Bought coins top up what a player can stake but never their leaderboard score
// (see computeBankroll in betting.ts). The host controls re-buys with one knob
// that has three states, stored unambiguously on the room:
//   off       — buying disabled (the default for every existing and new room).
//   unlimited — any whole amount allowed.
//   limited   — cumulative purchased coins may not exceed `cap`.
// On the room: `purchaseUnlimited === true` ⇒ unlimited; else a positive
// `purchaseCap` ⇒ that ceiling; else (absent/0) ⇒ off.
export type PurchaseCap =
  | { kind: "off" }
  | { kind: "unlimited" }
  | { kind: "limited"; cap: number };

export function purchaseCapOf(room: {
  purchaseCap?: number;
  purchaseUnlimited?: boolean;
}): PurchaseCap {
  if (room.purchaseUnlimited) return { kind: "unlimited" };
  if (room.purchaseCap != null && room.purchaseCap > 0)
    return { kind: "limited", cap: Math.floor(room.purchaseCap) };
  return { kind: "off" };
}

// How many more coins a player may buy under the cap. `null` = unlimited.
export function remainingAllowance(
  cap: PurchaseCap,
  alreadyPurchased: number,
): number | null {
  if (cap.kind === "off") return 0;
  if (cap.kind === "unlimited") return null;
  return Math.max(0, cap.cap - alreadyPurchased);
}

// Validate a re-buy request against the room cap and the player's existing
// cumulative purchased total. Whole numbers ≥ 1 only; cumulative purchased may
// never exceed a numeric cap; "unlimited" bypasses the ceiling; "off" forbids
// buying entirely. The single source of truth for the buyCoins mutation and the
// client's buy control.
export function validatePurchase(
  cap: PurchaseCap,
  alreadyPurchased: number,
  amount: number,
): { ok: true } | { ok: false; error: string } {
  if (cap.kind === "off")
    return { ok: false, error: "Buying coins is off for this room." };
  if (!Number.isInteger(amount) || amount < 1)
    return { ok: false, error: "Buy a whole number of coins (at least 1)." };
  if (cap.kind === "unlimited") return { ok: true };
  const remaining = cap.cap - alreadyPurchased;
  if (amount > remaining)
    return {
      ok: false,
      error: `That's over the buy cap — you can buy ${Math.max(0, remaining)} more.`,
    };
  return { ok: true };
}

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
