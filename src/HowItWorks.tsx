import { ENTRY_FEE, TIERS } from "../convex/pool";

// ── How it works - a plain-language guide to the whole game ──
// Deliberately simple: short numbered steps anyone can follow, then the
// scoring, then donation banking details (placeholders for now).
const STEPS: { title: string; body: string }[] = [
  {
    title: "Start or join a draw",
    body: "One person creates a draw, gives it a name and sets the buy-in. Everyone else joins with the 4-letter code.",
  },
  {
    title: "Everyone pays in",
    body: `Each player puts in the same buy-in (default R${ENTRY_FEE}). Add it all up and that's the pot - the prize the winner takes home.`,
  },
  {
    title: "The live draw",
    body: `Teams are split into ${TIERS} pots - strong, middle and outsiders. On your turn you tap to draw, and you get one random team from each pot. No picking - it's pure luck.`,
  },
  {
    title: "Pick your African team",
    body: "On top of your drawn teams, choose one African nation as a bonus. It's your free pick - and it scores double points.",
  },
  {
    title: "Follow the World Cup",
    body: "As real matches are played, your teams earn points automatically. The live standings show exactly where everyone stands.",
  },
  {
    title: "Best squad wins the pot",
    body: "When the tournament ends, whoever's teams scored the most points wins. Winner takes the whole pot.",
  },
];

export default function HowItWorks() {
  return (
    <>
      <header className="wrap">
        <div className="kicker">The guide · 2026</div>
        <h1>
          How it <em>works</em>
        </h1>
        <p className="sub">
          A friendly sweepstake for the World Cup. Draw your teams, follow the
          matches, and the best squad takes the pot. Here's the whole thing in
          six steps.
        </p>
      </header>

      <section className="section wrap">
        <ol className="hiw-steps">
          {STEPS.map((s, i) => (
            <li className="hiw-step" key={s.title}>
              <span className="hiw-num">{i + 1}</span>
              <div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="section wrap">
        <div className="shead">
          <h2>How points work</h2>
          <span>simple football scoring</span>
          <div className="rule" />
        </div>
        <div className="hiw-scoring">
          <div className="hiw-score">
            <span className="hiw-pts">3</span>
            <span className="hiw-lbl">points for a win</span>
          </div>
          <div className="hiw-score">
            <span className="hiw-pts">1</span>
            <span className="hiw-lbl">point for a draw</span>
          </div>
          <div className="hiw-score">
            <span className="hiw-pts">0</span>
            <span className="hiw-lbl">points for a loss</span>
          </div>
          <div className="hiw-score afr">
            <span className="hiw-pts">×2</span>
            <span className="hiw-lbl">your African team scores double</span>
          </div>
        </div>
        <p className="hint" style={{ marginTop: 16 }}>
          Your total is every team's points added together - with your African
          pick counted twice. Highest total when the World Cup ends wins.
        </p>
      </section>

      <section className="section wrap">
        <div className="shead">
          <h2>Support the project</h2>
          <span>donations welcome - completely optional</span>
          <div className="rule" />
        </div>
        <p className="hint" style={{ marginBottom: 18 }}>
          This is built and run for the love of the game. If you'd like to chip
          in to keep it going, here are the banking details. Thank you! 🙏
        </p>
        <div className="hiw-bank">
          <BankRow label="Account holder" value="MR LD DUVAL" />
          <BankRow label="Bank" value="Standard Bank" />
          <BankRow label="Account number" value="28 139 551 9" />
          <BankRow label="Branch name" value="Humansdorp" />
          <BankRow label="Branch code" value="051001" />
          <BankRow label="Account type" value="Current" />
        </div>
      </section>
    </>
  );
}

function BankRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="hiw-bank-row">
      <span className="hiw-bank-label">{label}</span>
      <span className="hiw-bank-value">{value}</span>
    </div>
  );
}
