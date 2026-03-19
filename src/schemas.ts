import { Type, type Static } from "@sinclair/typebox";

// /push — query param for agent pubkey/token (legacy, unauthenticated)
export const PushQuerySchema = Type.Object(
  { pubkey: Type.Optional(Type.String()) },
  { additionalProperties: true }
);
export type PushQuery = Static<typeof PushQuerySchema>;

// Ed25519 public key: 32 bytes = 64 hex chars
export const Ed25519PubkeySchema = Type.String({
  pattern: "^[0-9a-fA-F]{64}$",
  minLength: 64,
  maxLength: 64,
});
export type Ed25519Pubkey = Static<typeof Ed25519PubkeySchema>;

// Headers for Ed25519-authenticated routes (optional so verifyEd25519 returns 401 when missing)
export const Ed25519HeadersSchema = Type.Object(
  { "x-agent-pubkey": Type.Optional(Ed25519PubkeySchema) },
  { additionalProperties: true }
);

// /push/token — system push to a specific agent pubkey
export const PushTokenSchema = Type.Object(
  {
    pubkey: Type.String(),
    body: Type.String(),
  },
  { additionalProperties: false }
);
export type PushTokenBody = Static<typeof PushTokenSchema>;

// /push/topic — system push to all agents subscribed to a topic
export const PushTopicSchema = Type.Object(
  {
    topic: Type.String(),
    body: Type.String(),
  },
  { additionalProperties: false }
);
export type PushTopicBody = Static<typeof PushTopicSchema>;

// /send — agent-to-agent; server injects `from` from X-Agent-Pubkey
export const SendSchema = Type.Object(
  {
    to: Type.String(),
    body: Type.String(),
  },
  { additionalProperties: false }
);
export type SendBody = Static<typeof SendSchema>;
