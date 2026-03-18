// /push/token and /push/topic — body is always a plain string; no from field
export const pushTokenSchema = {
  type: "object",
  required: ["pubkey", "body"],
  properties: {
    pubkey: { type: "string" },
    body: { type: "string" },
  },
  additionalProperties: false,
};

export const pushTopicSchema = {
  type: "object",
  required: ["topic", "body"],
  properties: {
    topic: { type: "string" },
    body: { type: "string" },
  },
  additionalProperties: false,
};

// /send — agent-to-agent; server injects `from` from X-Agent-Pubkey
export const sendSchema = {
  type: "object",
  required: ["to", "body"],
  properties: {
    to: { type: "string" },
    body: { type: "string" },
  },
  additionalProperties: false,
};
