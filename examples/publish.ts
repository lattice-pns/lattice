/**
 * Example publisher script.
 *
 * Usage:
 *   bun run examples/publish.ts token <deviceToken> <body>
 *   bun run examples/publish.ts topic <topic>       <body>
 *   bun run examples/publish.ts send  <deviceToken> <body>
 *
 * Examples:
 *   bun run examples/publish.ts token abc123 "Hello world"
 *   bun run examples/publish.ts topic sports "Goal! 2-1"
 *   bun run examples/publish.ts send abc123 "Hi from sender"
 */

import { generateKeyPairSync, sign } from "crypto";

const PUSH_SECRET = process.env.PUSH_SECRET ?? "dev-push-secret";
const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:3000";

const [mode, target, body] = process.argv.slice(2);

if (!mode || !target || !body) {
  console.error(
    "Usage: publish.ts <token|topic|send> <deviceToken|topic> <body>"
  );
  process.exit(1);
}

if (mode !== "token" && mode !== "topic" && mode !== "send") {
  console.error(`Unknown mode "${mode}". Use "token", "topic", or "send".`);
  process.exit(1);
}

function generateKeys(): { pubkeyHex: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const spkiDer = Buffer.from(
    publicKey.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""),
    "base64"
  );
  const pubkeyHex = spkiDer.slice(-32).toString("hex");
  return { pubkeyHex, privateKeyPem: privateKey };
}

function signRequest(
  privateKeyPem: string,
  bodyStr: string,
  timestamp: number
): string {
  const payload = `${bodyStr};${timestamp}`;
  const sig = sign(null, Buffer.from(payload), privateKeyPem);
  return sig.toString("hex");
}

if (mode === "send") {
  const { pubkeyHex, privateKeyPem } = generateKeys();
  const requestBody = {
    deviceToken: target,
    notification: { body },
  };
  const bodyStr = JSON.stringify(requestBody);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signRequest(privateKeyPem, bodyStr, timestamp);

  console.log(`Sending as pubkey=${pubkeyHex} to device ${target}`);

  const res = await fetch(`${SERVER_URL}/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Pubkey": pubkeyHex,
      "X-Timestamp": String(timestamp),
      "X-Signature": signature,
    },
    body: bodyStr,
  });

  const json = await res.json();

  if (!res.ok) {
    console.error(`Error ${res.status}:`, json);
    process.exit(1);
  }

  console.log(`Sent:`, json);
} else {
  const endpoint = mode === "token" ? "/push/token" : "/push/topic";
  const bodyKey = mode === "token" ? "deviceToken" : "topic";

  const payload = {
    [bodyKey]: target,
    notification: { body },
  };

  const res = await fetch(`${SERVER_URL}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PUSH_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = await res.json();

  if (!res.ok) {
    console.error(`Error ${res.status}:`, json);
    process.exit(1);
  }

  console.log(`Sent to ${mode} "${target}":`, json);
}
