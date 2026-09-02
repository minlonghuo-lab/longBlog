#!/usr/bin/env python3
import hashlib
import hmac
import json
import os
import subprocess
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer

HOST = "127.0.0.1"
PORT = 8787
SERVICE_DIR = os.path.abspath(os.path.dirname(__file__))
ROOT_DIR = os.path.dirname(SERVICE_DIR)
RUNTIME_DIR = os.environ.get("LONGBLOG_RUNTIME_DIR", f"{ROOT_DIR}/runtime")
WEBHOOK_SECRET = os.environ.get("TRILIUM_PUBLISH_WEBHOOK_SECRET", "")
SYNC_COMMAND = ["/bin/sh", f"{SERVICE_DIR}/run_sync_and_build.sh"]
LOG_FILE = os.environ.get("LONGBLOG_WEBHOOK_LOG", f"{RUNTIME_DIR}/logs/trilium_sync_webhook.log")
CTX_FILE = f"{RUNTIME_DIR}/state/last_webhook.json"


def ensure_dirs():
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    os.makedirs(os.path.dirname(CTX_FILE), exist_ok=True)


def log_line(message: str):
    ensure_dirs()
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(message + "\n")


def verify_signature(raw_body: bytes, header_value: str) -> bool:
    if not WEBHOOK_SECRET:
        return False
    if not header_value or not header_value.startswith("sha256="):
        return False
    received = header_value[len("sha256="):].strip()
    expected = hmac.new(WEBHOOK_SECRET.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(received, expected)


def validate_payload(payload: dict):
    event = payload.get("event")
    note_id = payload.get("noteId")
    if event not in {"publish_changed", "sync_requested", "pinned_changed", "ai_refresh_requested"}:
        return False, "invalid event"
    if not note_id or not isinstance(note_id, str):
        return False, "missing noteId"
    if event == "publish_changed":
        publish = str(payload.get("publish", "")).lower()
        if publish not in {"true", "false"}:
            return False, "invalid publish"
    if event == "sync_requested":
        sync = str(payload.get("sync", "")).lower()
        if sync != "true":
            return False, "invalid sync"
    if event == "pinned_changed":
        pinned = str(payload.get("pinned", "")).lower()
        if pinned not in {"true", "false"}:
            return False, "invalid pinned"
    if event == "ai_refresh_requested":
        ai_refresh = str(payload.get("aiRefresh", "")).lower()
        if ai_refresh != "true":
            return False, "invalid aiRefresh"
    return True, ""


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/trilium-sync-webhook":
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"not found")
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length)
            signature = self.headers.get("X-Trilium-Signature", "")
            if not verify_signature(raw_body, signature):
                log_line("signature verification failed")
                self.send_response(401)
                self.end_headers()
                self.wfile.write(b"invalid signature")
                return
            payload = json.loads(raw_body.decode("utf-8"))
            ok, reason = validate_payload(payload)
            if not ok:
                log_line(f"payload rejected: {reason}")
                self.send_response(400)
                self.end_headers()
                self.wfile.write(reason.encode("utf-8"))
                return
            request_id = payload.get("requestId") or str(uuid.uuid4())
            ctx = {
                "requestId": request_id,
                "event": payload.get("event"),
                "noteId": payload.get("noteId"),
                "noteTitle": payload.get("noteTitle"),
                "publish": payload.get("publish"),
                "sync": payload.get("sync"),
                "pinned": payload.get("pinned"),
                "aiRefresh": payload.get("aiRefresh"),
                "triggeredAt": payload.get("triggeredAt"),
            }
            ensure_dirs()
            with open(CTX_FILE, "w", encoding="utf-8") as f:
                json.dump(ctx, f, ensure_ascii=False, indent=2)
            log_line(
                f"accepted webhook: requestId={request_id}, event={ctx['event']}, noteId={ctx['noteId']}, "
                f"noteTitle={ctx['noteTitle']}, publish={ctx['publish']}, sync={ctx['sync']}, "
                f"pinned={ctx['pinned']}, aiRefresh={ctx['aiRefresh']}"
            )
            subprocess.Popen(SYNC_COMMAND, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True, "message": "sync triggered", "requestId": request_id, "event": ctx["event"]}).encode("utf-8"))
        except Exception as e:
            log_line(f"handler error: {e}")
            self.send_response(500)
            self.end_headers()
            self.wfile.write(b"internal error")

    def log_message(self, format, *args):
        return


if __name__ == "__main__":
    if not WEBHOOK_SECRET:
        raise RuntimeError("Missing environment variable: TRILIUM_PUBLISH_WEBHOOK_SECRET")
    ensure_dirs()
    server = HTTPServer((HOST, PORT), Handler)
    log_line(f"starting server at http://{HOST}:{PORT}/trilium-sync-webhook")
    server.serve_forever()
