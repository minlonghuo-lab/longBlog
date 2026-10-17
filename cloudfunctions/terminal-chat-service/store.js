const SESSIONS = 'terminal_chat_sessions';
const MESSAGES = 'terminal_chat_messages';

function createCloudStore(db) {
  const checked = async operation => {
    const result = await operation;
    if (result.code) throw Object.assign(new Error('Database operation failed'), { code: result.code });
    return result;
  };
  const read = async ref => {
    const result = await checked(ref.get());
    const value = (Array.isArray(result.data) ? result.data[0] : result.data) || null;
    if (!value) return null;
    const { _id, ...data } = value;
    return data;
  };
  return {
    getSession: id => read(db.collection(SESSIONS).doc(id)),
    async transaction(work) {
      return db.runTransaction(transaction => work({
        getSession: id => read(transaction.collection(SESSIONS).doc(id)),
        putSession: (id, data) => checked(transaction.collection(SESSIONS).doc(id).set(data)),
        getMessage: id => read(transaction.collection(MESSAGES).doc(id)),
        putMessage: (id, data) => checked(transaction.collection(MESSAGES).doc(id).set(data)),
      }));
    },
    async listMessages(sessionId, cursor, limit) {
      const result = await checked(db.collection(MESSAGES).where({ sessionId, sequence: db.command.gt(cursor) })
        .orderBy('sequence', 'asc').limit(limit).get());
      return result.data;
    },
    async setNotification(id, notification) {
      const result = await checked(db.collection(MESSAGES).doc(id).update({ notification }));
      if (result.updated !== 1) throw new Error('Message was not updated');
    },
  };
}

module.exports = { createCloudStore };
