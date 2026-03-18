export const notificationSchema = {
  type: "object",
  required: ["body"],
  properties: {
    body: { type: "string" },
    from: { type: "string" },
  },
};

/** /send only: notification has body. Server injects from from X-Agent-Pubkey. */
export const sendNotificationSchema = {
  type: "object",
  required: ["body"],
  properties: { body: { type: "string" } },
  additionalProperties: false,
};
