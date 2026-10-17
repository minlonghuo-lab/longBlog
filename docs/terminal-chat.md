# Terminal chat v1

The blog remains an Astro static site. `chat` lazily loads a small browser module;
all ordinary commands remain local. Production calls one CloudBase **Event**
function through an HTTP access service. No CloudBase client SDK is shipped.

## Confirmed deployment target

- Environment: `memos-d5gadal6x556878b4`
- Region: `ap-shanghai`
- New function: `terminal-chat-service`, Node.js 20.19, 256 MB, 20 seconds.
- New HTTP access-service prefix: `/terminal-chat`.
- Notifications: an enterprise WeChat **group webhook**, with a link to the mobile reply page.
- Same-tab continuity: `sessionStorage`, 100 cached messages. Ordinary page entry
  does not connect; the visitor must explicitly enter `chat` again.
- Session expiration: seven days from the first saved message. Author links expire
  after 24 hours and grant read/reply access only to their own session.

Deployment is pending CloudBase CLI login and the private WeCom webhook. An
environment ID alone does not authorize cloud API calls. Local verification uses
an in-memory double; it does not prove the real database or WeCom delivery works.

## Local verification

```sh
npm ci
npm test
npm run preview:chat
```

Open `http://127.0.0.1:8787/about/`, enter `chat` and send a message. The local-only
`http://127.0.0.1:8787/__preview/notifications` endpoint exposes the simulated
notification links. Open one to reply, then return to the visitor tab. This server
binds to loopback, has no persistent storage, and must never be deployed.

## Private configuration

```sh
npm run chat:prepare
```

The first run creates `.env.terminal-chat.local` with a random signing key and
restricts file permissions to the current user. It intentionally exits with a
missing-field message until `WECOM_BOT_WEBHOOK` has been filled in locally.
Do not paste credentials into issues, PRs, chat, public environment variables, or
the repository's tracked `.env`. Only these private variables go on the function:

| Variable | Purpose |
| --- | --- |
| `CHAT_API_BASE_URL` | Actual HTTPS gateway prefix; verify the domain in the existing environment |
| `CHAT_ALLOWED_ORIGINS` | Comma-separated exact blog origins; defaults to `https://huowenlong.com` |
| `CHAT_SIGNING_KEY` | At least 32 random bytes encoded as hex; used to sign scoped author links and hash IP buckets |
| `WECOM_BOT_WEBHOOK` | Private `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…` URL |

After filling in the missing values, run `npm run chat:prepare` again. It creates
the ignored, private `.cloudbase/terminal-chat.deploy.json`. The public example
and committed `cloudbaserc.chat.json` never contain credentials. Keep the signing
key stable across deployments; rotating it invalidates existing author links.

## Prepare isolated cloud resources

In the **existing environment's document database**, create only these collections.
Do not change Memos collections, SQL tables, environment-wide permissions or existing routes.

| Collection | Browser security rules | Indexes |
| --- | --- | --- |
| `terminal_chat_sessions` | `{"read":false,"write":false}` | `purgeAfter` ascending |
| `terminal_chat_messages` | `{"read":false,"write":false}` | `sessionId` ascending + `sequence` ascending (unique); `purgeAfter` ascending |

Both collections are accessed only by the server SDK. Set the **specific**
`terminal-chat-service` function's client SDK invoke permission to false; preserve
all other function rules. Anonymous HTTP access is intentional: visitor capability
keys and signed author tokens are validated inside the function.

Session records store a SHA-256 digest of a 256-bit visitor key, a server-issued
sequence counter and expiration. The sessions collection also holds short-lived,
HMAC-hashed IP rate counters. No raw IP or User-Agent is stored.
Messages store sender, plain text, client ID, sequence, creation/expiration and
notification state. Their deterministic document IDs make retries idempotent.

The same function has an hourly `terminal-chat-cleanup` timer. It removes up to 50
expired documents per collection per run in bounded batches. Seven-day expiration
is enforced by authorization immediately; physical deletion happens on subsequent
cleanup runs and can lag during a backlog. No TTL-index support is assumed.

## Deploy after login

The commands below were checked against CloudBase CLI 3.8.7. Run from the repo root:

```sh
npm exec --yes --package=@cloudbase/cli@3.8.7 -- tcb login
npm run chat:prepare
npm exec --yes --package=@cloudbase/cli@3.8.7 -- tcb --config-file .cloudbase/terminal-chat.deploy.json -e memos-d5gadal6x556878b4 -r ap-shanghai fn deploy terminal-chat-service
npm exec --yes --package=@cloudbase/cli@3.8.7 -- tcb -e memos-d5gadal6x556878b4 -r ap-shanghai service create -p /terminal-chat -f terminal-chat-service
```

This is an Event function exposed through an HTTP access service, **not** an HTTP
web-server function: do not pass `--httpFn` or add `scf_bootstrap`. It uses the
Event runtime's server SDK credentials. Check for an existing function/route before
deploying; do not force-overwrite an unrelated resource. Verify the new timer and
collection rules in the console after deployment.

Check the actual gateway URL matches `CHAT_API_BASE_URL`, including its prefix.
Restrict gateway traffic for `/terminal-chat/*` separately where supported. Application
limits are two seconds between user messages, 20 sends per source IP per minute,
five new sessions per source IP per hour, 200 messages per session and 500 UTF-16
code units per message. The source IP comes from gateway `requestContext.sourceIp`
(or `requestContext.http.sourceIp`); if absent, requests share a conservative
fallback bucket. Confirm the real event shape during cloud integration. A visitor's
`X-Forwarded-For` value is not trusted. These limits do not replace gateway limits
for high-volume polling or invalid unauthenticated requests.

## Enable the blog last

Only after cloud send, notification and mobile reply work, set this **public build**
variable in the blog deployment settings and rebuild:

```dotenv
PUBLIC_TERMINAL_CHAT_API_URL=https://memos-d5gadal6x556878b4.ap-shanghai.app.tcloudbase.com/terminal-chat
```

Use the verified gateway URL if it differs from this expected URL. This is the only
new `PUBLIC_` variable. When absent, `chat` displays an unavailable notice and sends
no requests; the rest of the terminal continues to work.

## API contract

All API responses are `Cache-Control: no-store`. Credentials use the Authorization
header, never query parameters. Author links carry their token in the URL fragment;
the mobile page removes it from the address bar immediately and keeps it in that
tab's session storage. It has no analytics or external assets, a restrictive CSP,
`Referrer-Policy: no-referrer`, and no-index metadata.

| Endpoint | Credential | Input/result |
| --- | --- | --- |
| `POST /chat/send` | `Bearer <64-char visitor key>` | `{sessionId,messageId,message}`; creates a session atomically with its first message |
| `GET /chat/poll?sessionId=…&cursor=0` | Visitor key or scoped author token | `{messages:[{id,sender,text,createdAt,sequence}],cursor,hasMore}`; page size 50 |
| `POST /chat/reply` | `Bearer <signed author token>` | `{sessionId,messageId,message}`; visitor keys cannot write as author |
| `GET /reply` | No data until token validation | Mobile HTML |
| `GET /reply.js` | Public | Mobile client script |

IDs are 16 cryptographically random bytes as 32 hex characters. A retry must use
the same message ID and text. Reusing an ID for different text returns 409. Cursors
are server sequence numbers, not browser timestamps; multiple messages in the same
millisecond and paginated results cannot be skipped.

## Notification and failure behavior

The message is committed before the webhook is called, with a five-second webhook
timeout. The API acknowledges a saved message even if notification fails; the
browser does not claim the author read it. Notification errors are stored as
`notification: failed`, with a code-only function log. First version has no durable
notification retry worker: a runtime crash after commit can also leave `pending`.
Inspect failed/pending records in the server console; new visitor messages produce
fresh notifications and reply links. Repeated client retries never send duplicate
notifications for an already stored message.

Visitor polling uses one non-overlapping timeout chain (4 → 15 → 30 seconds while
idle), pauses when hidden, and aborts on exit/navigation. Poll failures back off
and show a reconnect notice after repeated failures. Send errors retain the original
message ID for retry; a subsequent poll reconciles an ambiguous send result.
Messages are inserted via `textContent`; no visitor/author HTML is rendered.

## Acceptance and rollback

- Verify profile, aliases, projects, knowledge, history and clear send **zero chat requests**.
- Enter chat without sending: no session or cloud request is created.
- Send a real test message; confirm stored record, mobile WeCom notification and scoped reply URL.
- Reply from a phone; confirm author output in the original browser without a false online/read claim.
- Leave the page, reply, return to the same tab and enter chat; confirm missed replies appear once.
- Simulate a dropped send response, retry, and verify only one message/notification exists.
- Exit or navigate repeatedly; verify requests stop and no detached handlers update old output.
- Attempt another session's key, a visitor key at `/chat/reply`, an expired link and an invalid origin; all must fail.
- Check the hourly cleanup, actual gateway source-IP shape, rate limits and index query performance in CloudBase.

For rollback, remove `PUBLIC_TERMINAL_CHAT_API_URL` and rebuild first; then disable
only the chat gateway route/timer if needed. Do not delete existing Memos resources.

The pinned official `@cloudbase/node-sdk` dependency currently inherits npm audit
advisories in its database and HTTP dependencies. Request URLs, document fields and
query operators are constructed by this service, not supplied by visitors. Recheck
the vendor's patched SDK before cloud deployment; do not run a broad `npm audit fix
--force` against the existing blog or replace SDK internals blindly.

Official references: [HTTP access](https://docs.cloudbase.net/service/access-cloud-function),
[transactions](https://github.com/TencentCloudBase/node-sdk/blob/master/docs/database/database.md),
[function deployment](https://docs.cloudbase.net/cli-v1/functions/deploy).
