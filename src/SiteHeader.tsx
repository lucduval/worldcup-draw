import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Avatar } from "./shared";

// Persistent top-of-app navigation shown on every signed-in screen.
// Inline links on desktop; a hamburger that drops a full-width menu on mobile.
type NavItem = { to: string; label: string; soon?: boolean };

const NAV: NavItem[] = [
  { to: "/games", label: "My games" },
  { to: "/how-it-works", label: "How it works" },
  { to: "/standings", label: "Standings" },
  { to: "/fixtures", label: "Fixtures" },
  { to: "/results", label: "Results" },
  { to: "/facts", label: "WC facts" },
];

export default function SiteHeader() {
  const { signOut } = useAuthActions();
  const me = useQuery(api.account.me);
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  // Close the mobile menu whenever the route changes.
  useEffect(() => setOpen(false), [pathname]);

  // Lock body scroll while the mobile menu is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <NavLink to="/games" className="brand">
          The World Cup <em>Draw</em>
        </NavLink>

        {/* Desktop: inline links */}
        <nav className="site-nav" aria-label="Primary">
          {NAV.map((item) =>
            item.soon ? (
              <span key={item.to} className="site-link is-soon" aria-disabled="true">
                {item.label}
                <span className="soon-tag">Soon</span>
              </span>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `site-link${isActive ? " active" : ""}`
                }
              >
                {item.label}
              </NavLink>
            ),
          )}
          <NavLink
            to="/account"
            className={({ isActive }) =>
              `site-account${isActive ? " active" : ""}`
            }
          >
            <Avatar src={me?.imageUrl} name={me?.name ?? "?"} size={26} />
            <span>My Account</span>
          </NavLink>
          <button className="site-signout" onClick={() => void signOut()}>
            Sign out
          </button>
        </nav>

        {/* Mobile: hamburger toggle */}
        <button
          className={`hamburger${open ? " is-open" : ""}`}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>

      {/* Mobile: slide-down menu */}
      {open && (
        <div
          className="site-menu-backdrop"
          aria-hidden="true"
          onClick={() => setOpen(false)}
        />
      )}
      <nav
        className={`site-menu${open ? " is-open" : ""}`}
        aria-label="Mobile"
      >
        {NAV.map((item) =>
          item.soon ? (
            <span key={item.to} className="site-menu-link is-soon">
              {item.label}
              <span className="soon-tag">Soon</span>
            </span>
          ) : (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `site-menu-link${isActive ? " active" : ""}`
              }
            >
              {item.label}
            </NavLink>
          ),
        )}
        <NavLink
          to="/account"
          className={({ isActive }) =>
            `site-menu-link site-menu-account${isActive ? " active" : ""}`
          }
        >
          <Avatar src={me?.imageUrl} name={me?.name ?? "?"} size={28} />
          <span>My Account</span>
        </NavLink>
        <button
          className="site-menu-signout"
          onClick={() => void signOut()}
        >
          Sign out
        </button>
      </nav>
    </header>
  );
}
