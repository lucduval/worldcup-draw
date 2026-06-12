import { Link } from "react-router-dom";

// A light-hearted footer that rides along on every page. The banking details
// mirror the "Support the project" block in How it works, so a friend can chip
// in from wherever they happen to be standing.
export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-wrap">
        <div className="footer-top">
          <div className="footer-brand">
            <span className="footer-mark">
              The luck of the <em>draw</em>
            </span>
            <p className="footer-blurb">
              A blind draw, three teams each, eternal bragging rights. Built on a
              couch for a group chat that takes the World Cup far too seriously.
            </p>
          </div>

          <nav className="footer-nav" aria-label="Footer">
            <Link to="/games" className="footer-link">The draw</Link>
            <Link to="/fixtures" className="footer-link">Fixtures</Link>
            <Link to="/standings" className="footer-link">Standings</Link>
            <Link to="/results" className="footer-link">Results</Link>
            <Link to="/facts" className="footer-link">Facts</Link>
            <Link to="/how-it-works" className="footer-link">How it works</Link>
          </nav>
        </div>

        <div className="footer-tip">
          <div className="footer-tip-head">
            <span className="footer-tip-title">Buy the ref a drink 🍺</span>
            <span className="footer-tip-sub">
              Tips keep the lights on - entirely optional, deeply appreciated.
            </span>
          </div>
          <div className="footer-bank">
            <FootBank label="Holder" value="MR LD DUVAL" />
            <FootBank label="Bank" value="Standard Bank" />
            <FootBank label="Account" value="28 139 551 9" />
            <FootBank label="Branch" value="051001" />
          </div>
        </div>

        <div className="footer-bottom">
          <span>© 2026 The luck of the draw. No refunds, no VAR.</span>
          <span className="footer-made">Made with ☕ and questionable group-stage predictions.</span>
        </div>
      </div>
    </footer>
  );
}

function FootBank({ label, value }: { label: string; value: string }) {
  return (
    <span className="footer-bankrow">
      <span className="footer-banklabel">{label}</span>
      <span className="footer-bankvalue">{value}</span>
    </span>
  );
}
