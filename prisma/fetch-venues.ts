/**
 * Discover COMMERCIAL / popular football venues via Google Places API (New),
 * ranked by real-world popularity — not every random pitch in OSM. Writes
 * prisma/venues.json (import shape) + prisma/venues-preview.json (with the
 * rating/userRatingCount/types kept for human review).
 *
 * Usage:
 *   npx tsx prisma/fetch-venues.ts                 # Prague, top 60, full
 *   npx tsx prisma/fetch-venues.ts Prague 60       # explicit city + count
 *   npx tsx prisma/fetch-venues.ts Prague 60 --preview   # discovery only,
 *                                                          # no photos, no R2
 *
 * Why Google over OSM: Places exposes `userRatingCount` + `rating`, which is
 * the exact "popular & commercial, not amateur" signal we want — a random
 * out-of-town pitch has ~0 reviews, a real rental sportcentrum has dozens.
 * `locationRestriction` (a city rectangle) keeps results in-city. Address comes
 * from Places `formattedAddress`, so OSM/Overpass/Nominatim are gone.
 *
 * Photos (hybrid): the top Google photo is downloaded and uploaded to R2 (when
 * R2_* env vars are set), else the venue keeps `photoUrl: null` and the app
 * falls back to its coverId gradient. Storing Google photo bytes is a ToS grey
 * area — fine at this personal scale, with author attribution kept in the
 * preview file; swap any in /admin/venues. Requires GOOGLE_PLACES_API_KEY.
 */
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

process.loadEnvFile(".env.local");

const city = process.argv[2] ?? "Prague";
const count = parseInt(process.argv[3] ?? "60", 10);
const PREVIEW = process.argv.includes("--preview");

const PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!PLACES_API_KEY) {
  console.error("GOOGLE_PLACES_API_KEY is required (set it in .env.local).");
  process.exit(1);
}

/** City rectangles (low = SW, high = NE) — also reused as the search bias. */
const RECTANGLES: Record<string, { s: number; w: number; n: number; e: number }> = {
  Prague: { s: 49.94, w: 14.22, n: 50.18, e: 14.71 },
  Praha: { s: 49.94, w: 14.22, n: 50.18, e: 14.71 },
  Brno: { s: 49.1, w: 16.45, n: 49.28, e: 16.74 },
  Bratislava: { s: 48.03, w: 16.99, n: 48.24, e: 17.24 },
};
const rect = RECTANGLES[city] ?? RECTANGLES["Prague"]!;

/** Czech + English search terms aimed at rentable / commercial football venues. */
const QUERIES = [
  "fotbalové hřiště pronájem",
  "minifotbal hřiště",
  "fotbalový stadion",
  "sportovní centrum fotbal",
  "fotbalová aréna",
  "indoor football",
  "football pitch",
  "soccer field",
];

// Popularity BAND, not just a floor. Reviews are a fame signal, not a
// rentability one: below MIN are no-name amateur pitches; above MAX are famous
// landmarks you can't book a kickabout at (O2 28k, Fortuna 13k, pro stadiums).
// Real rentable football centres sit in between (~tens to ~1.2k reviews). MAX
// is calibrated to the Prague gap between Olšanka/HAMR (~1.2k) and the pro
// cluster (Slavia/Juliska/Sparta, 1.4k+); retune per city.
const MIN_RATING_COUNT = 8;
const MAX_RATING_COUNT = 1300;

// NOTE: Google `primaryType` is NOT a reliable football discriminator here —
// real football venues come back tagged swimming_pool / tennis_court /
// sporting_goods_store / amusement_center. So we DON'T exclude by type; we
// include on a name/type hint and exclude clearly-non-football NAMES.
const SPORTS_TYPES = new Set([
  "sports_complex",
  "stadium",
  "sports_activity_location",
  "athletic_field",
  "sports_club",
]);
const NAME_HINT = /fotbal|football|soccer|hřišt|aréna|arena|sport|stadion/i;
/** Clearly-non-football names to drop (ice/lacrosse/golf/pool/novelty/non-venue). */
const EXCLUDE_NAME =
  /lakros|golf|zimní|hokej|hockey|bazén|koupali|plave|plavec|squash|bowling|atletick|bubble|bumper|sázk|poradenstv|verifikace/i;

const COVERS = Array.from({ length: 12 }, (_, i) =>
  `cover-${String(i + 1).padStart(3, "0")}`,
);

type Place = {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
  types?: string[];
  primaryType?: string;
  googleMapsUri?: string;
  websiteUri?: string;
  photos?: Array<{ name: string; authorAttributions?: Array<{ displayName: string }> }>;
};

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.businessStatus",
  "places.types",
  "places.primaryType",
  "places.googleMapsUri",
  "places.websiteUri",
  "places.photos",
].join(",");

async function searchText(textQuery: string): Promise<Place[]> {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": PLACES_API_KEY!,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: `${textQuery} ${city}`,
      languageCode: "cs",
      maxResultCount: 20,
      locationRestriction: {
        rectangle: {
          low: { latitude: rect.s, longitude: rect.w },
          high: { latitude: rect.n, longitude: rect.e },
        },
      },
    }),
  });
  if (!res.ok) {
    console.warn(`  searchText "${textQuery}" → HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return [];
  }
  return ((await res.json()) as { places?: Place[] }).places ?? [];
}

function isRelevant(p: Place): boolean {
  if (p.businessStatus && p.businessStatus !== "OPERATIONAL") return false;
  const rc = p.userRatingCount ?? 0;
  if (rc < MIN_RATING_COUNT || rc > MAX_RATING_COUNT) return false;
  const name = p.displayName?.text ?? "";
  if (EXCLUDE_NAME.test(name)) return false;
  const typeMatch = (p.types ?? []).some((t) => SPORTS_TYPES.has(t));
  const nameMatch = NAME_HINT.test(name);
  return typeMatch || nameMatch;
}

function score(p: Place): number {
  return (p.rating ?? 0) * Math.log1p(p.userRatingCount ?? 0);
}

function inferSurface(name: string): ["grass"] | ["hard"] {
  return /umě|artific|hala|indoor|tartan|beton|s umělým/i.test(name)
    ? ["hard"]
    : ["grass"];
}

function slugify(s: string, fallback: string): string {
  const slug = s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug || fallback;
}

// ── R2 upload (lazy; only in full mode) ──────────────────────────────────────
let r2: S3Client | null = null;
function r2Config() {
  const a = process.env.R2_ACCOUNT_ID;
  const k = process.env.R2_ACCESS_KEY_ID;
  const s = process.env.R2_SECRET_ACCESS_KEY;
  const b = process.env.R2_BUCKET;
  const u = process.env.R2_PUBLIC_BASE_URL;
  if (!a || !k || !s || !b || !u) return null;
  return { accountId: a, accessKeyId: k, secret: s, bucket: b, base: u.replace(/\/+$/, "") };
}

async function uploadPhoto(photoName: string, key: string): Promise<string | null> {
  const cfg = r2Config();
  if (!cfg) return null;
  const photoRes = await fetch(
    `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=1000&maxWidthPx=1600`,
    { headers: { "X-Goog-Api-Key": PLACES_API_KEY! } },
  );
  if (!photoRes.ok) {
    console.warn(`    photo HTTP ${photoRes.status}`);
    return null;
  }
  const bytes = new Uint8Array(await photoRes.arrayBuffer());
  if (!r2) {
    r2 = new S3Client({
      region: "auto",
      endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secret },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  await r2.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: bytes,
      ContentType: "image/jpeg",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  return `${cfg.base}/${key}`;
}

async function main() {
  console.log(`Discovering football venues in ${city} via Google Places (${QUERIES.length} queries)…`);

  const byId = new Map<string, Place>();
  for (const q of QUERIES) {
    const places = await searchText(q);
    for (const p of places) if (p.id) byId.set(p.id, p);
    console.log(`  "${q}" → ${places.length} (pool ${byId.size})`);
  }

  const ranked = [...byId.values()]
    .filter(isRelevant)
    .filter((p) => p.location)
    .sort((a, b) => score(b) - score(a))
    .slice(0, count);

  console.log(`\nPool ${byId.size} → relevant+popular → top ${ranked.length}\n`);

  const r2Ready = r2Config() !== null;
  if (!PREVIEW && !r2Ready) {
    console.log("⚠ R2 not configured — photos will be null (coverId fallback). Set R2_* to enable.\n");
  }

  const venues = [];
  const preview = [];
  for (let i = 0; i < ranked.length; i++) {
    const p = ranked[i]!;
    const name = p.displayName?.text ?? `Football Venue ${i + 1}`;
    const lat = p.location!.latitude;
    const lng = p.location!.longitude;
    const address = p.formattedAddress ?? `${lat}, ${lng}`;
    const googleMapsUrl =
      p.googleMapsUri ?? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    const surface = inferSurface(name);
    const coverId = COVERS[i % COVERS.length]!;

    let photoUrl: string | null = null;
    if (!PREVIEW && p.photos?.[0]?.name) {
      const key = `venues/${slugify(name, `venue-${i + 1}`)}-${p.id.slice(0, 8)}.jpg`;
      photoUrl = await uploadPhoto(p.photos[0].name, key);
    }

    venues.push({ name, address, lat, lng, googleMapsUrl, photoUrl, surface, coverId });
    preview.push({
      rank: i + 1,
      name,
      rating: p.rating ?? null,
      reviews: p.userRatingCount ?? 0,
      primaryType: p.primaryType ?? null,
      hasPhoto: Boolean(p.photos?.[0]),
      photoAttribution: p.photos?.[0]?.authorAttributions?.[0]?.displayName ?? null,
      website: p.websiteUri ?? null,
      address,
      surface: surface[0],
    });

    console.log(
      `  [${String(i + 1).padStart(2)}] ⭐${(p.rating ?? 0).toFixed(1)} (${String(p.userRatingCount ?? 0).padStart(4)}) ${name}${photoUrl ? "  📷" : ""}`,
    );
  }

  mkdirSync(resolve(process.cwd(), "prisma"), { recursive: true });
  writeFileSync(
    resolve(process.cwd(), "prisma/venues-preview.json"),
    JSON.stringify(preview, null, 2),
    "utf-8",
  );
  if (!PREVIEW) {
    writeFileSync(
      resolve(process.cwd(), "prisma/venues.json"),
      JSON.stringify(venues, null, 2),
      "utf-8",
    );
    console.log(`\nWrote ${venues.length} venues → prisma/venues.json (+ venues-preview.json)`);
  } else {
    console.log(`\nPREVIEW: wrote ranked candidates → prisma/venues-preview.json (no photos, no DB)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
