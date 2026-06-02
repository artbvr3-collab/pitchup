/**
 * One-off R2 connectivity check. Uploads a test image, fetches it back via the
 * public URL, then deletes it. Run: npx tsx prisma/test-r2.ts
 */
import { readFileSync } from "fs";
import { resolve } from "path";

import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

process.loadEnvFile(".env.local");

function mask(v: string | undefined): string {
  if (!v) return "❌ MISSING";
  return `✓ set (len ${v.length})`;
}

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secret = process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET;
const base = process.env.R2_PUBLIC_BASE_URL?.replace(/\/+$/, "");

console.log("R2 env:");
console.log(`  R2_ACCOUNT_ID         ${mask(accountId)}`);
console.log(`  R2_ACCESS_KEY_ID      ${mask(accessKeyId)}`);
console.log(`  R2_SECRET_ACCESS_KEY  ${mask(secret)}`);
console.log(`  R2_BUCKET             ${bucket ? `✓ ${bucket}` : "❌ MISSING"}`);
console.log(`  R2_PUBLIC_BASE_URL    ${base ? `✓ ${base}` : "❌ MISSING"}`);

if (!accountId || !accessKeyId || !secret || !bucket || !base) {
  console.error("\n❌ Some vars are missing — fix .env.local and re-run.");
  process.exit(1);
}

const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey: secret },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

const key = "test/r2-connectivity-check.jpg";

async function main() {
  const bytes = readFileSync(resolve("public/venues/003-umt.jpg"));

  // 1) upload (write credentials)
  process.stdout.write("\n1) Uploading test image… ");
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket!,
        Key: key,
        Body: bytes,
        ContentType: "image/jpeg",
      }),
    );
    console.log("✓ upload OK (write creds work)");
  } catch (e) {
    console.log("❌ FAILED");
    console.error("   →", (e as Error).message);
    console.error("   Check R2_ACCOUNT_ID / keys / bucket name.");
    process.exit(1);
  }

  // 2) public fetch (public access enabled?)
  const publicUrl = `${base}/${key}`;
  process.stdout.write(`2) Fetching ${publicUrl} … `);
  const res = await fetch(publicUrl);
  if (res.ok) {
    const ct = res.headers.get("content-type");
    const len = res.headers.get("content-length");
    console.log(`✓ HTTP ${res.status} (${ct}, ${len} bytes) — public access works`);
  } else {
    console.log(`❌ HTTP ${res.status}`);
    console.error(
      "   Upload worked but the public URL doesn't serve it. Likely the bucket's",
    );
    console.error(
      "   Public Development URL (Шаг 3) isn't enabled, or R2_PUBLIC_BASE_URL is wrong.",
    );
  }

  // 3) cleanup
  process.stdout.write("3) Deleting test object… ");
  await client.send(new DeleteObjectCommand({ Bucket: bucket!, Key: key }));
  console.log("✓ done");

  console.log(
    res.ok
      ? "\n✅ R2 is fully wired — uploads + public serving both work."
      : "\n⚠️ Write works, public serving does not — enable the Public Development URL.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
