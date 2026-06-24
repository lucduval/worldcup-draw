// PROTOTYPE TUI shell — throwaway. A thin, hand-driven terminal over the pure
// reducer in logic.ts. Run with:  npm run prototype:betting
//
// Nothing in here is production code: it reads one line, dispatches one action,
// clears the screen, and re-renders the whole frame so you always see one stable
// view of the bankroll model. The logic module is the only bit worth keeping.

import * as readline from "node:readline";
import {
  dispatch,
  bankrollOf,
  remaining,
  capLabel,
  flagOf,
  oddsLine,
  isOpen,
  isFinished,
  isKnockoutStage,
  type State,
  type Action,
  type BetPick,
} from "./logic.ts";

const B = "\x1b[1m";
const D = "\x1b[2m";
const R = "\x1b[0m";
const G = "\x1b[32m";
const RED = "\x1b[31m";
const Y = "\x1b[33m";

// Seed scenario: a lopsided group match, an even group match, and a knockout.
// extIds are short and memorable for typing.
function seed(): State {
  return {
    startingPot: 30,
    purchasedCoins: 0,
    cap: { kind: "limited", cap: 50 },
    clock: 0,
    bets: [],
    matches: [
      // lopsided group game — heavy favourite, draw priced
      { extId: 1, homeTeam: "France", awayTeam: "Haiti", stage: "GROUP_STAGE", status: "SCHEDULED" },
      // even group game — draw is most likely-ish
      { extId: 2, homeTeam: "Germany", awayTeam: "Croatia", stage: "GROUP_STAGE", status: "SCHEDULED" },
      // knockout — no draw outcome
      { extId: 3, homeTeam: "Brazil", awayTeam: "England", stage: "ROUND_OF_16", status: "SCHEDULED" },
    ],
  };
}

let state = seed();
let lastMsg = `${D}seeded: pot 30, buy-cap 50, 3 matches${R}`;

function money(n: number): string {
  const s = n > 0 ? `+${n}` : `${n}`;
  return n > 0 ? `${G}${s}${R}` : n < 0 ? `${RED}${s}${R}` : `${D}${s}${R}`;
}

function statusTag(m: { status: string; winner?: BetPick }): string {
  if (isFinished(m)) return `${B}FINISHED${R} ${D}(${m.winner})${R}`;
  if (isOpen(m.status)) return `${G}OPEN${R}`;
  return `${Y}${m.status}${R} ${D}(locked)${R}`;
}

function render() {
  console.clear();
  const bk = bankrollOf(state);
  const rem = remaining(state);

  const line = "─".repeat(64);
  console.log(`${B}WORLD CUP BETTING — bankroll model prototype${R}  ${D}(throwaway)${R}`);
  console.log(D + line + R);

  // ── Bankroll panel ──
  console.log(`${B}Bankroll${R}`);
  console.log(`  ${D}starting pot     ${R}${bk.startingPot}`);
  console.log(`  ${D}purchased coins  ${R}${bk.purchasedCoins}   ${D}(lift available, never the score)${R}`);
  console.log(`  ${D}settled net      ${R}${money(bk.settledNet)}`);
  console.log(`  ${D}pending stakes   ${R}${bk.pendingStakes}   ${D}(held in score, withheld from available)${R}`);
  console.log(`  ${B}bankroll (SCORE) ${R}${B}${bk.bankroll}${R}   ${D}folds into leaderboard; floored at 0${R}`);
  console.log(`  ${B}available        ${R}${B}${bk.available}${R}   ${D}what you can stake now; floored at 0${R}`);
  // baseline = a player who never bets just keeps their starting pot as score.
  const delta = bk.bankroll - bk.startingPot;
  console.log(
    `  ${D}vs non-bettor (score ${bk.startingPot}): ${R}${money(delta)} ${D}on the leaderboard${R}`,
  );
  console.log(`  ${D}buy allowance: ${capLabel(state.cap)} → ${rem == null ? "∞" : rem} more${R}`);

  // ── Matches panel ──
  console.log(D + line + R);
  console.log(`${B}Matches${R}`);
  for (const m of state.matches) {
    const o = oddsLine(m);
    const ko = isKnockoutStage(m.stage);
    const mine = state.bets.find((b) => b.matchExtId === m.extId);
    const odds = ko
      ? `H ${o.HOME.toFixed(2)}  A ${o.AWAY.toFixed(2)}`
      : `H ${o.HOME.toFixed(2)}  D ${(o.DRAW ?? 0).toFixed(2)}  A ${o.AWAY.toFixed(2)}`;
    console.log(
      `  ${B}#${m.extId}${R} ${flagOf(m.homeTeam)} ${m.homeTeam} v ${m.awayTeam} ${flagOf(m.awayTeam)} ` +
        `${D}[${ko ? "KO" : "GROUP"}]${R}  ${statusTag(m)}`,
    );
    console.log(`       ${D}odds:${R} ${odds}`);
    if (mine) {
      const won = isFinished(m) ? mine.pick === m.winner : null;
      const tag =
        won === null
          ? `${Y}pending${R}`
          : won
            ? `${G}WON ${money(Math.round(mine.stake * mine.odds) - mine.stake)}${R}`
            : `${RED}LOST -${mine.stake}${R}`;
      console.log(
        `       ${B}your bet:${R} ${mine.pick} ${mine.stake} @ ${mine.odds.toFixed(2)} → ${tag}`,
      );
    }
  }

  // ── Commands ──
  console.log(D + line + R);
  console.log(
    `${B}bet${R} ${D}<#> <home|draw|away> <stake>${R}   ` +
      `${B}cancel${R} ${D}<#>${R}   ` +
      `${B}kick${R} ${D}<#>${R}   ` +
      `${B}finish${R} ${D}<#> <home|draw|away>${R}`,
  );
  console.log(
    `${B}reopen${R} ${D}<#>${R}   ` +
      `${B}buy${R} ${D}<amt>${R}   ` +
      `${B}pot${R} ${D}<amt>${R}   ` +
      `${B}cap${R} ${D}<off|unlimited|N>${R}   ` +
      `${B}reset${R}   ${B}q${R} ${D}quit${R}`,
  );
  if (lastMsg) console.log(`\n${lastMsg}`);
}

const PICKS: Record<string, BetPick> = {
  home: "HOME",
  draw: "DRAW",
  away: "AWAY",
  h: "HOME",
  d: "DRAW",
  a: "AWAY",
};

function parse(input: string): Action | "reset" | "quit" | null {
  const [cmd, ...rest] = input.trim().split(/\s+/);
  switch (cmd) {
    case "":
      return null;
    case "q":
    case "quit":
      return "quit";
    case "reset":
      return "reset";
    case "bet": {
      const pick = PICKS[rest[1]?.toLowerCase()];
      if (!pick) throw new Error("usage: bet <#> <home|draw|away> <stake>");
      return { t: "bet", extId: Number(rest[0]), pick, stake: Number(rest[2]) };
    }
    case "cancel":
      return { t: "cancel", extId: Number(rest[0]) };
    case "kick":
      return { t: "kick", extId: Number(rest[0]) };
    case "reopen":
      return { t: "reopen", extId: Number(rest[0]) };
    case "finish": {
      const winner = PICKS[rest[1]?.toLowerCase()];
      if (!winner) throw new Error("usage: finish <#> <home|draw|away>");
      return { t: "finish", extId: Number(rest[0]), winner };
    }
    case "buy":
      return { t: "buy", amount: Number(rest[0]) };
    case "pot":
      return { t: "pot", amount: Number(rest[0]) };
    case "cap": {
      const spec = rest[0];
      if (spec === "off" || spec === "unlimited")
        return { t: "cap", spec };
      return { t: "cap", spec: Number(spec) };
    }
    default:
      throw new Error(`unknown command: ${cmd}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function loop() {
  render();
  rl.question("\n> ", (input) => {
    try {
      const action = parse(input);
      if (action === "quit") {
        console.clear();
        console.log("bye — capture what you learned in NOTES.md before deleting.");
        rl.close();
        return;
      }
      if (action === "reset") {
        state = seed();
        lastMsg = `${D}reset to seed${R}`;
      } else if (action) {
        state = dispatch(state, action);
        lastMsg = `${G}ok:${R} ${D}${input.trim()}${R}`;
      }
    } catch (e) {
      lastMsg = `${RED}rejected:${R} ${(e as Error).message}`;
    }
    loop();
  });
}

loop();
