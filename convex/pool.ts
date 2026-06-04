// Single source of truth shared by the Convex backend AND the React client.
// 48 nations, three tiers of 16. Edit freely — flags are emoji.

export const REVEAL_MS = 2600;
export const MAX_PLAYERS = 16; // one team per tier per player, 16 teams per tier
export const ENTRY_FEE = 100; // R100 buy-in

export type PoolTeam = { name: string; flag: string; tier: number };

// The confirmed 48-team field for the 2026 World Cup (USA / Canada / Mexico),
// seeded into three tiers of 16 by approximate FIFA ranking.
// Verified Jun 2026 — Italy & Denmark did NOT qualify; Iraq and DR Congo came
// through the intercontinental playoffs. Cape Verde, Curaçao, Jordan and
// Uzbekistan are debutants.
export const POOL: PoolTeam[] = [
  // ── Tier 1 ──────────────────────────────────────────────
  { name: "Argentina", flag: "🇦🇷", tier: 1 },
  { name: "Spain", flag: "🇪🇸", tier: 1 },
  { name: "France", flag: "🇫🇷", tier: 1 },
  { name: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", tier: 1 },
  { name: "Brazil", flag: "🇧🇷", tier: 1 },
  { name: "Portugal", flag: "🇵🇹", tier: 1 },
  { name: "Netherlands", flag: "🇳🇱", tier: 1 },
  { name: "Belgium", flag: "🇧🇪", tier: 1 },
  { name: "Germany", flag: "🇩🇪", tier: 1 },
  { name: "Croatia", flag: "🇭🇷", tier: 1 },
  { name: "Morocco", flag: "🇲🇦", tier: 1 },
  { name: "Colombia", flag: "🇨🇴", tier: 1 },
  { name: "Uruguay", flag: "🇺🇾", tier: 1 },
  { name: "USA", flag: "🇺🇸", tier: 1 },
  { name: "Japan", flag: "🇯🇵", tier: 1 },
  { name: "Mexico", flag: "🇲🇽", tier: 1 },

  // ── Tier 2 ──────────────────────────────────────────────
  { name: "Switzerland", flag: "🇨🇭", tier: 2 },
  { name: "Senegal", flag: "🇸🇳", tier: 2 },
  { name: "Iran", flag: "🇮🇷", tier: 2 },
  { name: "South Korea", flag: "🇰🇷", tier: 2 },
  { name: "Ecuador", flag: "🇪🇨", tier: 2 },
  { name: "Austria", flag: "🇦🇹", tier: 2 },
  { name: "Australia", flag: "🇦🇺", tier: 2 },
  { name: "Sweden", flag: "🇸🇪", tier: 2 },
  { name: "Turkey", flag: "🇹🇷", tier: 2 },
  { name: "Norway", flag: "🇳🇴", tier: 2 },
  { name: "Canada", flag: "🇨🇦", tier: 2 },
  { name: "Egypt", flag: "🇪🇬", tier: 2 },
  { name: "Panama", flag: "🇵🇦", tier: 2 },
  { name: "Algeria", flag: "🇩🇿", tier: 2 },
  { name: "Paraguay", flag: "🇵🇾", tier: 2 },
  { name: "Ivory Coast", flag: "🇨🇮", tier: 2 },

  // ── Tier 3 ──────────────────────────────────────────────
  { name: "Qatar", flag: "🇶🇦", tier: 3 },
  { name: "Scotland", flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", tier: 3 },
  { name: "Czechia", flag: "🇨🇿", tier: 3 },
  { name: "Tunisia", flag: "🇹🇳", tier: 3 },
  { name: "Saudi Arabia", flag: "🇸🇦", tier: 3 },
  { name: "South Africa", flag: "🇿🇦", tier: 3 },
  { name: "DR Congo", flag: "🇨🇩", tier: 3 },
  { name: "Iraq", flag: "🇮🇶", tier: 3 },
  { name: "Uzbekistan", flag: "🇺🇿", tier: 3 },
  { name: "Jordan", flag: "🇯🇴", tier: 3 },
  { name: "Ghana", flag: "🇬🇭", tier: 3 },
  { name: "Cape Verde", flag: "🇨🇻", tier: 3 },
  { name: "Curaçao", flag: "🇨🇼", tier: 3 },
  { name: "Haiti", flag: "🇭🇹", tier: 3 },
  { name: "New Zealand", flag: "🇳🇿", tier: 3 },
  { name: "Bosnia & Herzegovina", flag: "🇧🇦", tier: 3 },
];

export const TIERS = 3;
