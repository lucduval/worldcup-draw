import { useEffect, useMemo, useState } from "react";
import {
  FIXTURES,
  Fixture,
  ROUND_LABEL,
  flagFor,
  sastDate,
  sastTime,
  isUpcoming,
  involves,
} from "./fixtures";

const NEXT_COUNT = 5;

export default function Fixtures({
  myTeams,
  owners,
}: {
  myTeams?: string[];
  owners?: Record<string, string>;
}) {
  const owns = owners ?? {};
  const [open, setOpen] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Refresh once a minute so "next games" rolls forward on its own.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const teamSet = useMemo(() => new Set(myTeams ?? []), [myTeams]);
  const hasTeams = teamSet.size > 0;

  const { strip, stripLabel } = useMemo(() => {
    const upcoming = FIXTURES.filter((f) => isUpcoming(f.utc, now));
    if (hasTeams) {
      const mine = upcoming.filter((f) => involves(f, teamSet));
      if (mine.length)
        return { strip: mine.slice(0, NEXT_COUNT), stripLabel: "Your teams next" };
    }
    return { strip: upcoming.slice(0, NEXT_COUNT), stripLabel: "Next matches" };
  }, [now, hasTeams, teamSet]);

  const panelList = useMemo(
    () => (mineOnly ? FIXTURES.filter((f) => involves(f, teamSet)) : FIXTURES),
    [mineOnly, teamSet],
  );

  return (
    <section className="section wrap">
      <div className="shead">
        <h2>Fixtures</h2>
        <span>all times SAST</span>
        <div className="rule" />
      </div>

      <div className="fx-card">
        <div className="fx-cardhead">
          <span className="fx-cardlabel">{stripLabel}</span>
          <button className="fx-morebtn" onClick={() => setOpen(true)}>
            Full schedule →
          </button>
        </div>
        {strip.length === 0 ? (
          <div className="fx-empty">No upcoming matches - that's a wrap. 🏆</div>
        ) : (
          <div className="fx-list">
            {strip.map((f, i) => (
              <FixtureRow
                key={i}
                f={f}
                owners={owns}
                highlight={involves(f, teamSet)}
              />
            ))}
          </div>
        )}
      </div>

      {open && (
        <>
          <div className="fx-backdrop" onClick={() => setOpen(false)} />
          <aside className="fx-drawer" role="dialog" aria-label="Full schedule">
            <div className="fx-drawerhead">
              <div>
                <div className="fx-drawertitle">Full schedule</div>
                <div className="fx-drawersub">
                  104 matches · all times SAST
                </div>
              </div>
              <button
                className="fx-close"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {hasTeams && (
              <div className="fx-filter">
                <button
                  className={`fx-chip${!mineOnly ? " on" : ""}`}
                  onClick={() => setMineOnly(false)}
                >
                  All matches
                </button>
                <button
                  className={`fx-chip${mineOnly ? " on" : ""}`}
                  onClick={() => setMineOnly(true)}
                >
                  My teams
                </button>
              </div>
            )}

            <div className="fx-drawerbody">
              {panelList.length === 0 ? (
                <div className="fx-empty">
                  None of your teams have a fixed fixture yet.
                </div>
              ) : (
                <DayGroups list={panelList} teamSet={teamSet} owners={owns} />
              )}
            </div>
          </aside>
        </>
      )}
    </section>
  );
}

function DayGroups({
  list,
  teamSet,
  owners,
}: {
  list: Fixture[];
  teamSet: Set<string>;
  owners: Record<string, string>;
}) {
  // list is already sorted by utc; group consecutive matches by SAST date.
  const groups: { date: string; items: Fixture[] }[] = [];
  for (const f of list) {
    const d = sastDate(f.utc);
    const last = groups[groups.length - 1];
    if (last && last.date === d) last.items.push(f);
    else groups.push({ date: d, items: [f] });
  }
  return (
    <>
      {groups.map((g) => (
        <div className="fx-day" key={g.date}>
          <div className="fx-dayhead">{g.date}</div>
          <div className="fx-list">
            {g.items.map((f, i) => (
              <FixtureRow
                key={i}
                f={f}
                showDate={false}
                owners={owners}
                highlight={involves(f, teamSet)}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function FixtureRow({
  f,
  showDate = true,
  highlight = false,
  owners = {},
}: {
  f: Fixture;
  showDate?: boolean;
  highlight?: boolean;
  owners?: Record<string, string>;
}) {
  const badge =
    f.round === "group" ? `Group ${f.group}` : ROUND_LABEL[f.round];
  return (
    <div className={`fx-row${highlight ? " hot" : ""}`}>
      <div className="fx-when">
        {showDate && <span className="fx-date">{sastDate(f.utc)}</span>}
        <span className="fx-time">{sastTime(f.utc)}</span>
      </div>
      <div className="fx-match">
        <Side name={f.home} known={f.teamsKnown} owner={owners[f.home]} />
        <span className="fx-v">v</span>
        <Side
          name={f.away}
          known={f.teamsKnown}
          owner={owners[f.away]}
          align="right"
        />
      </div>
      <div className="fx-meta">
        <span className={`fx-badge r-${f.round}`}>{badge}</span>
        <span className="fx-venue">{f.venue}</span>
      </div>
    </div>
  );
}

function Side({
  name,
  known,
  owner,
  align,
}: {
  name: string;
  known: boolean;
  owner?: string;
  align?: "right";
}) {
  const flag = known ? flagFor(name) : null;
  const team = (
    <span className="fx-team">
      <span className={known ? "" : "fx-slot"}>{name}</span>
      {owner && <span className="fx-owner">{owner}</span>}
    </span>
  );
  return (
    <span className={`fx-side${align === "right" ? " r" : ""}`}>
      {align === "right" ? (
        <>
          {team}
          {flag && <span className="fx-flag">{flag}</span>}
        </>
      ) : (
        <>
          {flag && <span className="fx-flag">{flag}</span>}
          {team}
        </>
      )}
    </span>
  );
}
