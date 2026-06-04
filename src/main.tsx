import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// Convex is mounted only inside Live mode (see App.tsx → LiveApp),
// so the local one-device game works with no backend configured.
// Three Pelé / 1970 World Cup photos that slide right→left behind everything.
const BG_IMAGES = ["/bg/pele-1.jpeg", "/bg/pele-2.jpeg", "/bg/pele-3.jpeg"];

function BgSlide() {
  // Render the set twice so the track can loop seamlessly.
  const tiles = [...BG_IMAGES, ...BG_IMAGES];
  return (
    <div className="bg-slide" aria-hidden="true">
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BgSlide />
    <App />
  </React.StrictMode>,
);
