// Deterministic transactional double for service tests and local end-to-end preview.
function createMemoryStore() {
  let sessions = new Map();
  let messages = new Map();
  let queue = Promise.resolve();
  const clone = value => value == null ? null : structuredClone(value);
  return {
    getSession: async id => clone(sessions.get(id)),
    transaction(work) {
      const operation = queue.then(async () => {
        const nextSessions = structuredClone(sessions);
        const nextMessages = structuredClone(messages);
        const result = await work({
          getSession: async id => clone(nextSessions.get(id)),
          putSession: async (id, value) => { nextSessions.set(id, clone(value)); },
          getMessage: async id => clone(nextMessages.get(id)),
          putMessage: async (id, value) => { nextMessages.set(id, clone(value)); },
        });
        sessions = nextSessions; messages = nextMessages;
        return result;
      });
      queue = operation.catch(() => {});
      return operation;
    },
    async listMessages(sessionId, cursor, limit) {
      return [...messages.values()].filter(value => value.sessionId === sessionId && value.sequence > cursor)
        .sort((a, b) => a.sequence - b.sequence).slice(0, limit).map(clone);
    },
    async setNotification(id, notification) { messages.get(id).notification = notification; },
  };
}
module.exports = { createMemoryStore };
