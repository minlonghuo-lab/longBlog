# Terminal chat v1

The blog remains a static Astro site. Ordinary terminal commands stay local;
`chat` lazily loads the messaging client. Production uses one CloudBase Event
function exposed through the HTTP gateway, enterprise WeChat notifications and a
mobile reply page. No cloud SDK is shipped to visitors.

## Deployment target

- Environment: `memos-d5gadal6x556878b4`, region `ap-shanghai`.
- Existing database: **PostgreSQL** (`pgdb-nqzdym55`), not a document database.
- Private schema: `terminal_chat`, with `sessions` and `messages` tables.
- Function: `terminal-chat-service`, Node.js 20.19, 256 MB, 20-second timeout.
- HTTP prefix: `/terminal-chat`, on the existing custom domain `shuoshuo.huowenlong.com`.
- API: `https://shuoshuo.huowenlong.com/terminal-chat`.

The existing Memos root route, tables, schema permissions and gateway-wide
policies stay unchanged. A separate chat path is added on the same custom domain. `schema.sql` creates only the private chat objects.

## Local verification

```sh
npm ci
npm test
npm run preview:chat
```

Open `http://127.0.0.1:8787/about/`, enter `chat`, and send a message. Local simulated
notification links are at `/__preview/notifications`; open one to reply. This
loopback-only preview uses an in-memory PostgreSQL engine (PGlite), running the
**same SQL migration and transaction functions** as production. It never contacts
WeCom or Tencent Cloud and must never be deployed.

## Private configuration

```sh
npm run chat:prepare
```

On first use, this creates `.env.terminal-chat.local` with a random signing key and
owner-only file permissions. Fill `WECOM_BOT_WEBHOOK` locally and run it again to
generate `.cloudbase/terminal-chat.deploy.json`. Both private files are ignored by
Git. Do not put secrets in the repository's tracked `.env`, PRs or chat.

| Variable | Scope |
| --- | --- |
| `CHAT_API_BASE_URL` | Function only; exact verified HTTPS gateway prefix |
| `CHAT_ALLOWED_ORIGINS` | Function only; exact blog origins, comma-separated |
| `CHAT_SIGNING_KEY` | Function only; at least 32 random bytes as hex |
| `WECOM_BOT_WEBHOOK` | Function only; private WeCom group message-push URL |
| `CHAT_CLOUDBASE_ENV_ID` | Function only; filled by the preparation script |
| `PUBLIC_TERMINAL_CHAT_API_URL` | Public blog build override; never a secret |

The Event runtime supplies temporary `TENCENTCLOUD_SECRETID`,
`TENCENTCLOUD_SECRETKEY` and `TENCENTCLOUD_SESSIONTOKEN`. The official scoped
Tencent Cloud TCB SDK calls `ExecutePGSql` with the fixed environment ID. No
permanent cloud key or database password is configured. Keep the signing key stable
across deployments; rotating it invalidates existing author links.

## PostgreSQL setup and deployment

Inspect the target environment and existing resources first. Apply
`cloudfunctions/terminal-chat-service/schema.sql` as a transaction through the
CloudBase SQL console or `ExecutePGSql`. The script is idempotent for these objects:

- A private `terminal_chat` schema with PUBLIC access revoked.
- `sessions`: session metadata and hashed rate buckets, indexed by expiry.
- `messages`: message JSON, session and sequence columns, a unique session/sequence
  index, and an expiry index.
- Row-level security on both tables, no public policies or grants.
- `SECURITY INVOKER` SQL functions for transactional append and rate accounting;
  function EXECUTE permissions are revoked from PUBLIC. No SECURITY DEFINER API
  or public PostgREST resource is introduced.

The function executes as the environment's server-side SQL role, which owns these
new objects. SQL structure and identifiers are fixed. Values are encoded into
base64 literals because ExecutePGSql does not expose bind parameters. The atomic
append function takes consistently ordered transaction advisory locks, validates
session ownership, deduplicates message IDs, applies limits and allocates a server
sequence number. Failed appends roll back the message **and** rate counters.

After CLI login and private configuration:

```sh
npm exec --yes --package=@cloudbase/cli@3.8.7 -- tcb login
npm run chat:prepare
npm exec --yes --package=@cloudbase/cli@3.8.7 -- tcb --config-file .cloudbase/terminal-chat.deploy.json -e memos-d5gadal6x556878b4 -r ap-shanghai fn deploy terminal-chat-service
```

This is an **Event** function served by an HTTP gateway route. Do not pass
`--httpFn` or add `scf_bootstrap`. Add `/terminal-chat` on the existing custom domain `shuoshuo.huowenlong.com`,
forwarding to the new function, with path transmission enabled and gateway auth
disabled. Set total QPS to 30 and per-client IP QPS to 10. Application capability credentials still protect data. Preserve
all existing routes and authorization policies. Verify the hourly
`terminal-chat-cleanup` timer after deployment.

## Browser behavior and API

The public endpoint defaults to the deployed custom-domain URL above. An explicitly
empty `PUBLIC_TERMINAL_CHAT_API_URL` build override disables chat requests with a
clear unavailable notice. The system default domain is unsuitable for the reply
page because it forces HTML downloads; no new DNS record is needed for this setup. Entering chat
alone creates no session or backend request. A cryptographically random session ID
(16 bytes) and visitor key (32 bytes) are created with the first send.

| Endpoint | Authorization | Contract |
| --- | --- | --- |
| `POST /chat/send` | `Bearer <visitor key>` | `{sessionId,messageId,message}`; creates first message and session atomically |
| `GET /chat/poll?sessionId=…&cursor=0` | Visitor key or scoped author token | `{messages:[{id,sender,text,createdAt,sequence}],cursor,hasMore}` |
| `POST /chat/reply` | Scoped author token only | `{sessionId,messageId,message}` |
| `GET /reply` | Data requires a token | Mobile reply HTML |
| `GET /reply.js` | Public | Same-origin script |

The database stores only a SHA-256 digest of the visitor key. Author tokens are
HMAC-signed, valid for 24 hours and confined to one session. They travel in URL
fragments, which the mobile page removes immediately; subsequent API calls use
Authorization headers. The reply page has a restrictive CSP, no external assets
or analytics, no-index metadata and a no-referrer policy. API responses are no-store.
All message text is inserted using `textContent`.

Server sequence cursors avoid client clock skew and missed same-millisecond
messages. Fifty-message pages drain until caught up. A retry reuses its message ID;
changing text under an existing ID returns 409. Polling is one non-overlapping
timeout chain, with 4 → 15 → 30 second idle backoff. Hidden pages pause; exit and
Astro navigation abort requests. Send errors preserve retryable local rows.

Session storage keeps at most 100 cached messages in the current tab. Ordinary page
entry does not reconnect; re-enter `chat` to resume. Private message text never
enters shell history or command completion. `clear` in chat clears the display,
retaining the session. `exit`, `quit` and `:q` restore local commands.

## Limits and retention

- Up to 500 UTF-16 code units per message, 200 messages per session.
- At least two seconds between visitor sends.
- At most 20 visitor sends per source IP per minute and five new sessions per IP
  per hour. IP buckets are HMAC-hashed; no raw IP or User-Agent is stored.
- Session access expires seven days after the first message.
- Hourly cleanup removes up to 100 expired rows per table per run. Access expires
  immediately even if physical deletion lags behind a cleanup backlog.

Only gateway-provided source IP metadata is trusted, never a visitor's forwarded
header prefix. If metadata is unavailable, requests share a conservative fallback
bucket. Gateway limits are still needed for high-volume polling or invalid traffic.

Messages commit before the webhook request, which has a five-second timeout. Saved
messages remain acknowledged if notification fails; failure state is recorded and
logs contain codes only. A crash can leave `notification: pending`. The first
version has no durable notification retry worker; new visitor messages create new
notifications and fresh links. Client retries do not duplicate notifications.

## Cloud acceptance and rollback

Verify actual database row formats, runtime temporary credentials, gateway path and
IP event shape, CORS, phone notification/reply, scoped permissions, duplicate retry,
missed replies, timer invocation, and no changes to existing Memos routes. Local
PGlite tests do not replace these cloud checks.

To disable the browser integration, blank the public API setting and rebuild. If
necessary, disable only the chat route and timer. Do not alter existing Memos
resources. Keep private configuration and function environment variables out of
all published artifacts.

Official references: [PostgreSQL ExecutePGSql](https://cloud.tencent.com/document/api/876/130469),
[HTTP function access](https://docs.cloudbase.net/service/access-cloud-function),
[function deployment](https://docs.cloudbase.net/cli-v1/functions/deploy).
