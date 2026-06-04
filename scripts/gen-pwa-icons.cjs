/**
 * One-off generator for the PWA / home-screen icons.
 * Brand: green gradient tile + lime football (matches the splash ball).
 * Outputs PNGs into public/icons/. Re-run: `node scripts/gen-pwa-icons.cjs`.
 */
const path = require("path");
const fs = require("fs");

let sharp;
try {
  sharp = require("sharp");
} catch {
  // sharp is a transitive (Next) dep — resolve it from the pnpm store.
  sharp = require(
    path.join(process.cwd(), "node_modules/.pnpm/sharp@0.34.5/node_modules/sharp"),
  );
}

const OUT = path.join(process.cwd(), "public/icons");
fs.mkdirSync(OUT, { recursive: true });

/** A lime football centred at (256,256): pentagon + 5 radial seams. */
function ball(rb) {
  const cx = 256,
    cy = 256;
  const rp = rb * 0.34; // pentagon radius
  const rs = rb * 0.96; // seam reach
  const sw = Math.max(4, Math.round(rb * 0.07));
  const angles = [-90, -18, 54, 126, 198].map((d) => (d * Math.PI) / 180);
  const pent = angles
    .map((a) => `${(cx + rp * Math.cos(a)).toFixed(1)},${(cy + rp * Math.sin(a)).toFixed(1)}`)
    .join(" ");
  const seams = angles
    .map((a) => {
      const x1 = (cx + rp * Math.cos(a)).toFixed(1),
        y1 = (cy + rp * Math.sin(a)).toFixed(1);
      const x2 = (cx + rs * Math.cos(a)).toFixed(1),
        y2 = (cy + rs * Math.sin(a)).toFixed(1);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#0e5c2f" stroke-width="${sw}" stroke-linecap="round"/>`;
    })
    .join("");
  return `<circle cx="${cx}" cy="${cy}" r="${rb}" fill="#c5e63c"/>${seams}<polygon points="${pent}" fill="#0e5c2f"/>`;
}

function svg(rb) {
  return `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#176b38"/><stop offset="1" stop-color="#0e5c2f"/>
    </linearGradient></defs>
    <rect width="512" height="512" fill="url(#g)"/>
    ${ball(rb)}
  </svg>`;
}

async function render(svgStr, size, file) {
  await sharp(Buffer.from(svgStr)).resize(size, size).png().toFile(path.join(OUT, file));
  console.log("wrote", file, `${size}x${size}`);
}

(async () => {
  const base = svg(168); // full-bleed "any"
  const maskable = svg(120); // smaller ball, inside the maskable safe zone
  await render(base, 512, "icon-512.png");
  await render(base, 192, "icon-192.png");
  await render(base, 180, "apple-touch-icon.png");
  await render(base, 32, "favicon-32.png");
  await render(maskable, 512, "icon-maskable-512.png");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
