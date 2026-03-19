import { Type, type Static } from "@sinclair/typebox";

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
