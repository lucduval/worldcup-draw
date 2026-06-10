// ── World Cup facts - a fun, scannable list of trivia ──
// Reuses the "How it works" step-card styling: an emoji medallion beside
// each fact. All facts verified June 2026.
const FACTS: { emoji: string; body: string }[] = [
  {
    emoji: "🇧🇷",
    body: "Brazil have played in every single World Cup - all 22 since 1930. No other nation comes close.",
  },
  {
    emoji: "👑",
    body: "Pelé is the only player to win three World Cups (1958, 1962 and 1970) - and he was just 17 at his first.",
  },
  {
    emoji: "🏆",
    body: "Only eight nations have ever won it: Brazil (5), Germany & Italy (4), Argentina (3), France & Uruguay (2), England & Spain (1).",
  },
  {
    emoji: "⚡",
    body: "Fastest goal ever: 11 seconds - Turkey's Hakan Şükür vs South Korea in the 2002 third-place playoff. Unbeaten for over 20 years.",
  },
  {
    emoji: "🥅",
    body: "The highest-scoring game ever was Austria 7–5 Switzerland in 1954 - twelve goals in one match.",
  },
  {
    emoji: "😱",
    body: "Germany 7–1 Brazil in the 2014 semi-final - the host nation demolished on home soil in front of the world.",
  },
  {
    emoji: "🎯",
    body: "Miroslav Klose is the all-time top scorer with 16 goals across four tournaments (2002–2014).",
  },
  {
    emoji: "🐶",
    body: "The trophy was once stolen - and a dog found it. Before the 1966 finals the Jules Rimet Trophy was nicked in London, then sniffed out by a dog named Pickles.",
  },
  {
    emoji: "👴",
    body: "The oldest player ever was Egypt's keeper Essam El-Hadary, aged 45 at the 2018 World Cup.",
  },
  {
    emoji: "👶",
    body: "The youngest was Northern Ireland's Norman Whiteside, just 17 years and 41 days old in 1982.",
  },
  {
    emoji: "🌎",
    body: "2026 is the biggest ever - the first 48-team World Cup, hosted across three countries: the USA, Canada and Mexico.",
  },
  {
    emoji: "🇺🇾",
    body: "Uruguay won the very first World Cup in 1930 - on home soil, beating Argentina 4–2 in the final.",
  },
];

export default function WorldCupFacts() {
  return (
    <>
      <header className="wrap">
        <div className="kicker">Trivia · 2026</div>
        <h1>
          World Cup <em>facts</em>
        </h1>
        <p className="sub">
          A dozen bits of World Cup magic - record goals, stolen trophies and
          one very good dog. Perfect for settling an argument at half-time.
        </p>
      </header>

      <section className="section wrap">
        <ul className="hiw-steps">
          {FACTS.map((f) => (
            <li className="hiw-step" key={f.body}>
              <span className="hiw-num" aria-hidden="true">
                {f.emoji}
              </span>
              <div>
                <p>{f.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
