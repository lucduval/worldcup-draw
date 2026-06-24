// PROTOTYPE shim — re-exports the REAL pure pricing/cap helpers from the
// production module so the prototype prices bets and validates re-buys exactly
// as convex/betting.ts does. The only addition is a name→flag lookup, which
// betting.ts builds inline from POOL (not exported), rebuilt here the same way.
export {
  POOL,
  RANK_BY_NAME,
  matchOdds,
  apiMatchOdds,
  fairOdds,
  purchaseCapOf,
  remainingAllowance,
  validatePurchase,
  type BetPick,
  type PurchaseCap,
} from "../../convex/pool.ts";

import { POOL } from "../../convex/pool.ts";

export const FLAG_BY_NAME_FALLBACK: Record<string, string> = Object.fromEntries(
  POOL.map((t) => [t.name, t.flag]),
);
