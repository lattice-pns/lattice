import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * Fastify preHandler that authenticates clients using Ed25519 signatures.
 *
 * Required headers:
 *   X-Agent-Pubkey  — 64-char hex Ed25519 public key (32 bytes)
 *   X-Timestamp     — Unix timestamp in seconds (must be within ±30s of now)
 *   X-Signature     — 128-char hex Ed25519 signature (64 bytes)
 *
 * Signed payload (GET/DELETE): ";{timestamp}"
 * Signed payload (POST/PATCH): "{requestBody};{timestamp}"
 *
 * The public key is the agent identity.
 */
export async function verifyEd25519(
  req: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const pubkeyHex = req.headers["x-agent-pubkey"];
  const timestampStr = req.headers["x-timestamp"];
  const signatureHex = req.headers["x-signature"];

  if (
    typeof pubkeyHex !== "string" ||
    typeof timestampStr !== "string" ||
    typeof signatureHex !== "string"
  ) {
    throw unauthorized("Missing X-Agent-Pubkey, X-Timestamp, or X-Signature");
  }

  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 30) {
    throw unauthorized("Invalid or expired timestamp");
  }

  let pubkeyBytes: Uint8Array<ArrayBuffer>;
  let sigBytes: Uint8Array<ArrayBuffer>;
  try {
    const pk = Buffer.from(pubkeyHex, "hex");
    const sig = Buffer.from(signatureHex, "hex");
    pubkeyBytes = new Uint8Array(
      pk.buffer.slice(
        pk.byteOffset,
        pk.byteOffset + pk.byteLength
      ) as ArrayBuffer
    );
    sigBytes = new Uint8Array(
      sig.buffer.slice(
        sig.byteOffset,
        sig.byteOffset + sig.byteLength
      ) as ArrayBuffer
    );
  } catch {
    throw unauthorized("Invalid hex encoding");
  }

  if (pubkeyBytes.length !== 32 || sigBytes.length !== 64) {
    throw unauthorized("Invalid key or signature length");
  }

  const body =
    req.method === "GET" || req.method === "DELETE"
      ? ""
      : JSON.stringify(req.body);
  const payload = `${body};${timestamp}`;

  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      "raw",
      pubkeyBytes,
      { name: "Ed25519" },
      false,
      ["verify"]
    );
  } catch {
    throw unauthorized("Invalid public key");
  }

  const valid = await crypto.subtle.verify(
    { name: "Ed25519" },
    cryptoKey,
    sigBytes,
    new TextEncoder().encode(payload)
  );

  if (!valid) {
    throw unauthorized("Invalid signature");
  }
}

function unauthorized(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 401 });
}
