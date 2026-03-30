const crypto = require("crypto");

const attr = api.originEntity;

if (!attr) return;
if (attr.type !== "label") return;
if (!["publish", "sync", "pinned", "aiRefresh"].includes(attr.name)) return;

const note = api.getNote(attr.noteId);
if (!note || note.isDeleted) return;

const TEMPLATE_NOTE_IDS = new Set(["MC7PtiChdF5S"]);

function isTemplateNote(note) {
    if (!note) return false;
    if (TEMPLATE_NOTE_IDS.has(note.noteId)) return true;
    const title = (note.title || "").toLowerCase();
    if (title.includes("template") || title.includes("模板")) return true;
    const templateLabel = note.getLabel("template");
    if (templateLabel && !templateLabel.value) return true;
    return false;
}

if (isTemplateNote(note)) return;

const WEBHOOK_URL = "https://blog.ssaw.top/trilium-sync-webhook";
const WEBHOOK_SECRET = "bK9x_7QmP2vL8nR4sT6yZ1aW5cD3fH9J";

function setOrCreateLabel(note, name, value) {
    const existing = note.getLabel(name);
    if (existing) {
        existing.value = value;
        existing.save();
    } else {
        note.addLabel(name, value);
    }
}

function sendWebhook(payload, noticePrefix) {
    const rawBody = JSON.stringify(payload);
    const signature = crypto
        .createHmac("sha256", WEBHOOK_SECRET)
        .update(rawBody, "utf8")
        .digest("hex");

    return api.axios.post(WEBHOOK_URL, payload, {
        timeout: 15000,
        headers: {
            "Content-Type": "application/json",
            "X-Trilium-Signature": `sha256=${signature}`
        }
    }).then((response) => {
        setOrCreateLabel(
            note,
            "webhookNotice",
            `success:${noticePrefix}:${response.status}:${new Date().toISOString()}`
        );
        setOrCreateLabel(note, "debugWebhook", `${noticePrefix}:${response.status}`);
        return response;
    });
}

(async () => {
    try {
        if (attr.name === "publish") {
            const publishValue = (attr.value || "").toLowerCase();

            if (publishValue !== "true" && publishValue !== "false") {
                setOrCreateLabel(note, "webhookNotice", `ignored:publish:${publishValue}`);
                return;
            }

            const payload = {
                event: "publish_changed",
                requestId: `${note.noteId}-publish-${Date.now()}`,
                noteId: note.noteId,
                noteTitle: note.title,
                publish: publishValue,
                triggeredAt: new Date().toISOString()
            };

            await sendWebhook(payload, `publish:${publishValue}`);
            return;
        }

        if (attr.name === "sync") {
            const syncValue = (attr.value || "").toLowerCase();

            if (syncValue !== "true") {
                return;
            }

            const payload = {
                event: "sync_requested",
                requestId: `${note.noteId}-sync-${Date.now()}`,
                noteId: note.noteId,
                noteTitle: note.title,
                sync: syncValue,
                triggeredAt: new Date().toISOString()
            };

            await sendWebhook(payload, `sync:${syncValue}`);
            setOrCreateLabel(note, "syncStatus", "queued");
            return;
        }

        if (attr.name === "pinned") {
            const pinnedValue = (attr.value || "").toLowerCase();

            if (pinnedValue !== "true" && pinnedValue !== "false") {
                setOrCreateLabel(note, "webhookNotice", `ignored:pinned:${pinnedValue}`);
                return;
            }

            const payload = {
                event: "pinned_changed",
                requestId: `${note.noteId}-pinned-${Date.now()}`,
                noteId: note.noteId,
                noteTitle: note.title,
                pinned: pinnedValue,
                triggeredAt: new Date().toISOString()
            };

            await sendWebhook(payload, `pinned:${pinnedValue}`);
            setOrCreateLabel(note, "syncStatus", "queued");
            return;
        }

        if (attr.name === "aiRefresh") {
            const aiRefreshValue = (attr.value || "").toLowerCase();

            if (aiRefreshValue !== "true") {
                return;
            }

            const payload = {
                event: "ai_refresh_requested",
                requestId: `${note.noteId}-aiRefresh-${Date.now()}`,
                noteId: note.noteId,
                noteTitle: note.title,
                aiRefresh: aiRefreshValue,
                triggeredAt: new Date().toISOString()
            };

            await sendWebhook(payload, `aiRefresh:${aiRefreshValue}`);
            setOrCreateLabel(note, "syncStatus", "queued");
            return;
        }
    } catch (e) {
        setOrCreateLabel(
            note,
            "webhookNotice",
            `failed:${attr.name}:${(e && e.message) ? e.message : e}`
        );
        throw e;
    }
})();
