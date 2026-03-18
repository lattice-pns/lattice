# lattice

An APNs-inspired push notification server using Server-Sent Events (SSE). Agents hold open SSE connections identified by their Ed25519 public key. Other agents can send messages directly via `/send`, and backend systems can push notifications to specific agents or broadcast to a topic via `/push`.

## Setup

```bash
bun install
cp .env.example .env.local
```

## Development

```bash
bun run dev
```

## Environment Variables

| Variable      | Default                  | Description                     |
| ------------- | ------------------------ | ------------------------------- |
| `PUSH_SECRET` | `dev-push-secret`        | Bearer token for push endpoints |
| `REDIS_URL`   | `redis://localhost:6379` | Redis connection URL            |

## Authentication

Agents authenticate using **Ed25519 keypairs**. Each request must include these headers:

The signed payload differs by method:

- **GET** (e.g. `/subscribe`): `";{unix_timestamp}"`
- **POST** (e.g. `/send`): `"{requestBody};{unix_timestamp}"` — `requestBody` is the JSON-serialized request body

| Header           | Description                               |
| ---------------- | ----------------------------------------- |
| `X-Agent-Pubkey` | 64-char hex Ed25519 public key (32 bytes) |
| `X-Timestamp`    | Unix timestamp in seconds                 |
| `X-Signature`    | 128-char hex Ed25519 signature (64 bytes) |

The **public key is the agent identity**. Timestamps must be within ±30 seconds of the server clock (replay protection).

## API

### `GET /`

Health check. Returns the number of active connections.

```json
{ "status": "ok", "connections": 3 }
```

### `GET /subscribe?topics=`

Opens an SSE connection. Requires Ed25519 auth headers (see above).

| Query param | Required | Description                            |
| ----------- | -------- | -------------------------------------- |
| `topics`    | No       | Comma-separated list of topics to join |

The agent's identity is its `X-Agent-Pubkey`. If a client reconnects with the same public key, the previous connection is evicted. A `: ping` comment frame is sent every 25 seconds to keep the connection alive through proxies.

### `POST /push/token`

System push to a specific agent. Requires `Authorization: Bearer <PUSH_SECRET>`.

```json
{ "pubkey": "<64-char-hex-pubkey>", "body": "Hello world" }
```

Returns `404` if the agent is not connected.

### `POST /send`

Agent-to-agent message. Requires Ed25519 auth headers (same as `/subscribe`). The server injects `from` from the verified `X-Agent-Pubkey` header automatically.

```json
{ "to": "<64-char-hex-pubkey>", "body": "Hi from sender" }
```

Returns `404` if the recipient agent is not connected.

### `POST /push/topic`

System broadcast to all agents subscribed to a topic. Requires `Authorization: Bearer <PUSH_SECRET>`.

```json
{ "topic": "sports", "body": "Goal! 2-1" }
```

Returns `{ "ok": true, "recipients": N }`.

## SSE Event Format

```
id: <uuid>
event: notification
data: {"body":"...","from":"<optional-sender-pubkey-hex>"}
```

On connect, an initial `event: connected` frame is sent with the agent's `pubkey` (public key hex) and resolved topic list.

## Examples

**Subscribe** (terminal 1):

```bash
bun run examples/subscribe.ts sports,news
```

The subscriber prints its public key hex on connect — use that as the `pubkey` when pushing.

**Push to device** (terminal 2):

```bash
bun run examples/publish.ts token <pubkey-hex> "Hello world"
```

**Send to device** (Ed25519 auth — generates ephemeral keypair, injects sender pubkey):

```bash
bun run examples/publish.ts send <pubkey-hex> "Hi from sender"
```

**Broadcast to topic** (terminal 2):

```bash
bun run examples/publish.ts topic sports "Goal! 2-1"
```

The `publish.ts` script respects `PUSH_SECRET` and `SERVER_URL` env vars.
