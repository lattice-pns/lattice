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
  write: (event: SseEvent) => void;
  disconnect: () => void;
  heartbeatInterval: ReturnType<typeof setInterval>;
}
