export interface Notification {
  body: string;
  from?: string; // sender's Ed25519 public key hex; absent for system pushes
}

export interface SseEvent {
  id?: string;
  event?: string;
  data: string;
}

export interface SseClient {
  pubkey: string;
  topics: Set<string>;
  write: (event: SseEvent) => void;
  disconnect: () => void;
  heartbeatInterval: ReturnType<typeof setInterval>;
}

export interface SubscribeQuery {
  topics?: string;
}

// /push/token — system push to a specific agent pubkey
export interface PushTokenBody {
  pubkey: string;
  body: string;
}

// /push/topic — system push to all agents subscribed to a topic
export interface PushTopicBody {
  topic: string;
  body: string;
}

// /send — agent-to-agent message; `from` is injected by the server
export interface SendBody {
  to: string;
  body: string;
}
