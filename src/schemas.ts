import { Type, type Static } from "@sinclair/typebox";

// /push/:pubkey — path param for agent pubkey/token (unauthenticated)
export const PushParamsSchema = Type.Object(
  { pubkey: Type.String() },
  { additionalProperties: false }
);
export type PushParams = Static<typeof PushParamsSchema>;

// Ed25519 public key: 32 bytes = 64 hex chars
export const Ed25519PubkeySchema = Type.String({
  pattern: "^[0-9a-fA-F]{64}$",
  minLength: 64,
  maxLength: 64,
});
export type Ed25519Pubkey = Static<typeof Ed25519PubkeySchema>;

// Headers for Ed25519-authenticated routes (optional so verifyEd25519 returns 401 when missing)
// last-event-id: SSE reconnection; validated when present
export const Ed25519HeadersSchema = Type.Object(
  {
    "x-agent-pubkey": Type.Optional(Ed25519PubkeySchema),
    "last-event-id": Type.Optional(Type.String()),
  },
  { additionalProperties: true }
);

// /send — agent-to-agent; server injects `from` from X-Agent-Pubkey
export const SendSchema = Type.Object(
  {
    to: Type.String(),
    body: Type.String(),
  },
  { additionalProperties: false }
);
export type SendBody = Static<typeof SendSchema>;
