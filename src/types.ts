export interface NotificationPayload {
  body: string;
  from?: string; // sender's Ed25519 public key hex (optional)
}

export interface SseEvent {
  id?: string;
  event?: string;
  data: string;
}

export interface SseClient {
  deviceToken: string;
  topics: Set<string>;
  write: (event: SseEvent) => void;
  disconnect: () => void;
  heartbeatInterval: ReturnType<typeof setInterval>;
}

export interface SubscribeQuery {
  topics?: string;
}

export interface PushTokenBody {
  deviceToken: string;
  notification: NotificationPayload;
}

export interface PushTopicBody {
  topic: string;
  notification: NotificationPayload;
}
