import { BETTING, MODES, NAV, ScoringGrid, STEPS } from "./guideContent";

// ── How it works - a plain-language guide to the whole game ──
// Deliberately simple: short numbered steps anyone can follow, then the two
// draw styles, where to find everything, the scoring, and donation details.
// The steps/modes/nav/scoring all come from guideContent.tsx so the first-login
// walkthrough (IntroTour) stays word-for-word in sync with this page.

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
          six simple steps.
        </p>
      </header>

      <section className="section wrap">
        <ol className="hiw-steps">
          {STEPS.map((s, i) => (
            <li className="hiw-step has-art" key={s.title}>
              <span className="hiw-num">{i + 1}</span>
              <div className="hiw-step-main">
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                <div className="hiw-art">{s.art}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="section wrap">
        <div className="shead">
          <h2>Two ways to draw</h2>
          <span>the host picks the style - and can switch it in the lobby</span>
          <div className="rule" />
        </div>
        <ul className="hiw-steps">
          {MODES.map((m) => (
            <li className="hiw-step" key={m.title}>
              <span className="hiw-num hiw-ico">{m.icon}</span>
              <div>
                <h3>{m.title}</h3>
                <p>{m.body}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="hint" style={{ marginTop: 16 }}>
          Either way the teams are random and the scoring is identical - it's
          just whether you all draw together or in your own time.
        </p>
      </section>

      <section className="section wrap">
        <div className="shead">
          <h2>{BETTING.title}</h2>
          <span>a side game the host can switch on</span>
          <div className="rule" />
        </div>
        <div className="hiw-betting">
          <div>
            <p className="hiw-betting-intro">{BETTING.intro}</p>
            <ul className="hiw-betting-list">
              {BETTING.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
          <div className="hiw-art">{BETTING.art}</div>
        </div>
      </section>

      <section className="section wrap">
        <div className="shead">
          <h2>Getting around</h2>
          <span>what each spot in the top menu is for</span>
          <div className="rule" />
        </div>
        <ul className="hiw-steps">
          {NAV.map((n) => (
            <li className="hiw-step" key={n.title}>
              <span className="hiw-num hiw-ico">{n.icon}</span>
              <div>
                <h3>{n.title}</h3>
                <p>{n.body}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="hint" style={{ marginTop: 16 }}>
          On a phone, tap the menu button (top right) to find all of these. Your
          profile and sign-out live under <b>My Account</b>.
        </p>
      </section>

      <section className="section wrap">
        <div className="shead">
          <h2>How points work</h2>
          <span>simple football scoring</span>
          <div className="rule" />
        </div>
        <ScoringGrid />
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
