import { describe, expect, test } from "vitest";
import {
  purchaseCapOf,
  remainingAllowance,
  validatePurchase,
} from "./pool";

// The coin re-buy cap helper: the second pure seam of the buy-coins feature.
// Mirrors the shape of clampStartingPot — a pure clamp/validation helper.
describe("purchaseCapOf", () => {
  test("absent fields ⇒ Off (the default for every room)", () => {
    expect(purchaseCapOf({})).toEqual({ kind: "off" });
    expect(purchaseCapOf({ purchaseCap: 0 })).toEqual({ kind: "off" });
  });
  test("a positive cap ⇒ limited", () => {
    expect(purchaseCapOf({ purchaseCap: 50 })).toEqual({
      kind: "limited",
      cap: 50,
    });
  });
  test("the unlimited flag wins over any numeric cap", () => {
    expect(purchaseCapOf({ purchaseUnlimited: true })).toEqual({
      kind: "unlimited",
    });
    expect(
      purchaseCapOf({ purchaseUnlimited: true, purchaseCap: 50 }),
    ).toEqual({ kind: "unlimited" });
  });
});

describe("validatePurchase", () => {
  const off = purchaseCapOf({});
  const limited = purchaseCapOf({ purchaseCap: 100 });
  const unlimited = purchaseCapOf({ purchaseUnlimited: true });

  test("Off forbids all purchases", () => {
    expect(validatePurchase(off, 0, 10).ok).toBe(false);
  });

  test("a numeric cap allows cumulative buys up to but not past the ceiling", () => {
    // First buy of 60 under a cap of 100 is fine.
    expect(validatePurchase(limited, 0, 60).ok).toBe(true);
    // Having already bought 60, a further 40 reaches the cap exactly — allowed.
    expect(validatePurchase(limited, 60, 40).ok).toBe(true);
    // …but 41 would tip over 100 — rejected.
    expect(validatePurchase(limited, 60, 41).ok).toBe(false);
    // Already at the cap ⇒ nothing more.
    expect(validatePurchase(limited, 100, 1).ok).toBe(false);
  });

  test("Unlimited allows any whole amount", () => {
    expect(validatePurchase(unlimited, 0, 1).ok).toBe(true);
    expect(validatePurchase(unlimited, 9999, 9999).ok).toBe(true);
  });

  test("non-whole / < 1 amounts are rejected", () => {
    expect(validatePurchase(limited, 0, 0).ok).toBe(false);
    expect(validatePurchase(limited, 0, -5).ok).toBe(false);
    expect(validatePurchase(limited, 0, 2.5).ok).toBe(false);
    expect(validatePurchase(unlimited, 0, 2.5).ok).toBe(false);
  });
});

describe("remainingAllowance", () => {
  test("Off ⇒ 0, Unlimited ⇒ null, limited ⇒ cap − already (floored at 0)", () => {
    expect(remainingAllowance(purchaseCapOf({}), 0)).toBe(0);
    expect(remainingAllowance(purchaseCapOf({ purchaseUnlimited: true }), 5)).toBe(
      null,
    );
    expect(remainingAllowance(purchaseCapOf({ purchaseCap: 100 }), 30)).toBe(70);
    expect(remainingAllowance(purchaseCapOf({ purchaseCap: 100 }), 120)).toBe(0);
  });
});
