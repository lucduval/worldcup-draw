import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";

// Full-colour photos that slide right→left behind the sign-on gate, the same
// motion as the washed-out background on the rest of the app.
const AUTH_BG_IMAGES = ["/bg/zizou.jpeg", "/bg/dutch.jpeg", "/bg/maradona.jpeg"];

function AuthBgSlide() {
  // Render the set twice so the track can loop seamlessly.
  const tiles = [...AUTH_BG_IMAGES, ...AUTH_BG_IMAGES];
  return (
    <div className="auth-slide" aria-hidden="true">
      <div className="bg-track">
        {tiles.map((src, i) => (
          <div
            key={i}
            className="bg-tile"
            style={{ backgroundImage: `url("${src}")` }}
          />
        ))}
      </div>
    </div>
  );
}

// The welcome landing + sign up / sign in gate. This is the very first thing
// every visitor sees — game-mode selection only happens once you're in.
export default function AuthScreen() {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signUp");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const isSignUp = flow === "signUp";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (isSignUp && !name.trim()) return setErr("Pop your name in first.");
    if (!email.trim()) return setErr("Enter your email.");
    if (password.length < 8)
      return setErr("Password needs at least 8 characters.");
    setBusy(true);
    setErr("");
    try {
      await signIn(
        "password",
        isSignUp
          ? { name: name.trim(), email: email.trim(), password, flow }
          : { email: email.trim(), password, flow },
      );
      // On success the <Authenticated> branch takes over automatically.
    } catch {
      setErr(
        isSignUp
          ? "Couldn’t sign up — that email may already be registered."
          : "Wrong email or password.",
      );
      setBusy(false);
    }
  }

  return (
    <>
      <AuthBgSlide />

      <div className="auth-screen">
        <header className="wrap auth-head">
          <h1>
            The World Cup <em>Draw</em>
          </h1>
        </header>

        <div className="center-stage">
        <div className="panel">
          <h3>{isSignUp ? "Create your account" : "Welcome back"}</h3>
          <p className="hint">
            {isSignUp
              ? "One account, all your games — on any device."
              : "Sign in to pick up your draws."}
          </p>

          <form onSubmit={submit}>
            {isSignUp && (
              <div className="field">
                <label>Your name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Luc"
                  maxLength={18}
                />
              </div>
            )}

            <div className="field">
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </div>

            <div className="field">
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="8+ characters"
                autoComplete={isSignUp ? "new-password" : "current-password"}
              />
            </div>

            <button className="btn big" disabled={busy} type="submit">
              {isSignUp ? "Sign up →" : "Sign in →"}
            </button>
            <div className="err">{err}</div>
          </form>

          <div className="authtoggle">
            {isSignUp ? "Already have an account?" : "New here?"}{" "}
            <button
              type="button"
              onClick={() => {
                setErr("");
                setFlow(isSignUp ? "signIn" : "signUp");
              }}
            >
              {isSignUp ? "Sign in" : "Create one"}
            </button>
          </div>
        </div>
        </div>
      </div>
    </>
  );
}
