export interface Notification {
  body: string;
  from?: string; // sender's Ed25519 public key hex; absent for system pushes
  topic?: string; // topic name for `/push/topic` deliveries; absent otherwise
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
