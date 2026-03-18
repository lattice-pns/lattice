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
 * The public key doubles as the device token.
 */
export async function verifyEd25519(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const pubkeyHex = req.headers["x-agent-pubkey"];
  const timestampStr = req.headers["x-timestamp"];
  const signatureHex = req.headers["x-signature"];

  if (
    typeof pubkeyHex !== "string" ||
    typeof timestampStr !== "string" ||
    typeof signatureHex !== "string"
  ) {
    reply
      .code(401)
      .send({ error: "Missing X-Agent-Pubkey, X-Timestamp, or X-Signature" });
    return;
  }

  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 30) {
    reply.code(401).send({ error: "Invalid or expired timestamp" });
    return;
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
    reply.code(401).send({ error: "Invalid hex encoding" });
    return;
  }

  if (pubkeyBytes.length !== 32 || sigBytes.length !== 64) {
    reply.code(401).send({ error: "Invalid key or signature length" });
    return;
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
    reply.code(401).send({ error: "Invalid public key" });
    return;
  }

  const valid = await crypto.subtle.verify(
    { name: "Ed25519" },
    cryptoKey,
    sigBytes,
    new TextEncoder().encode(payload)
  );

  if (!valid) {
    reply.code(401).send({ error: "Invalid signature" });
    return;
  }
}
