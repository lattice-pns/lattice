/**
 * Example SSE subscriber client using Ed25519 key-pair authentication.
 *
 * On first run a keypair is generated and saved to ~/.lattice/.
 * The public key (hex) becomes the device token.
 *
 * Usage:
 *   bun run examples/subscribe.ts [topics]
 *
 * Examples:
 *   bun run examples/subscribe.ts
 *   bun run examples/subscribe.ts sports,news
 */

import { generateKeyPairSync, sign } from "crypto";

const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:3000";

// ── Key generation ────────────────────────────────────────────────────────────

function generateKeys(): { pubkeyHex: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  // Extract the raw 32-byte public key from the SPKI DER encoding.
  // SPKI for Ed25519 is: 12-byte algorithm header + 32-byte key material.
  const spkiDer = Buffer.from(
    publicKey.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""),
    "base64"
  );
  const pubkeyHex = spkiDer.slice(-32).toString("hex");

  return { pubkeyHex, privateKeyPem: privateKey };
}

// ── Request signing ───────────────────────────────────────────────────────────

function signRequest(
  privateKeyPem: string,
  body: string,
  timestamp: number
): string {
  const payload = `${body};${timestamp}`;
  const sig = sign(null, Buffer.from(payload), privateKeyPem);
  return sig.toString("hex");
}

// ── Main ──────────────────────────────────────────────────────────────────────

const { pubkeyHex, privateKeyPem } = generateKeys();
const topics = process.argv[2] ?? "general";
const timestamp = Math.floor(Date.now() / 1000);
const signature = signRequest(privateKeyPem, "", timestamp);

const url = `${SERVER_URL}/subscribe?topics=${encodeURIComponent(topics)}`;
console.log(`Connecting as pubkey=${pubkeyHex}, topics=${topics}`);

const res = await fetch(url, {
  headers: {
    "X-Agent-Pubkey": pubkeyHex,
    "X-Timestamp": String(timestamp),
    "X-Signature": signature,
  },
});

if (!res.ok || !res.body) {
  console.error(`Failed to connect: ${res.status} ${res.statusText}`);
  process.exit(1);
}

const decoder = new TextDecoder();
let buffer = "";

for await (const chunk of res.body) {
  buffer += decoder.decode(chunk, { stream: true });

  // SSE frames are separated by double newlines
  const frames = buffer.split("\n\n");
  buffer = frames.pop() ?? "";

  for (const frame of frames) {
    if (!frame.trim() || frame.startsWith(": ping")) continue;

    const lines = frame.split("\n");
    const parsed: Record<string, string> = {};
    for (const line of lines) {
      const colon = line.indexOf(":");
      if (colon === -1) continue;
      const key = line.slice(0, colon).trim();
      const value = line.slice(colon + 1).trim();
      parsed[key] = value;
    }

    const ts = new Date().toISOString();
    if (parsed.event === "connected") {
      console.log(`[${ts}] connected`, JSON.parse(parsed.data ?? "{}"));
    } else if (parsed.event === "notification") {
      console.log(`[${ts}] notification`, JSON.parse(parsed.data ?? "{}"));
    } else {
      console.log(`[${ts}] event=${parsed.event ?? "(none)"}`, parsed.data);
    }
  }
}
