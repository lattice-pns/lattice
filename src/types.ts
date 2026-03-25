export interface Notification {
  body: string;
  from?: string; // sender's Ed25519 public key hex; absent for system pushes
  topics?: string[]; // topics this notification was pushed to; absent for direct pushes
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
