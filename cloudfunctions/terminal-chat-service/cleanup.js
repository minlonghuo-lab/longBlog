const COLLECTIONS = ['terminal_chat_messages', 'terminal_chat_sessions'];

async function cleanupExpired(db, timestamp = Date.now()) {
  let deleted = 0;
  for (const collection of COLLECTIONS) {
    // Bounded work for the shared function's 20-second limit; hourly runs drain any backlog.
    const result = await db.collection(collection).where({ purgeAfter: db.command.lte(new Date(timestamp)) }).limit(50).get();
    if (result.code) throw new Error('Cleanup query failed');
    for (let offset = 0; offset < result.data.length; offset += 10) {
      const batch = await Promise.all(result.data.slice(offset, offset + 10).map(async document => {
        const removed = await db.collection(collection).doc(document._id).remove();
        if (removed.code) throw new Error('Cleanup deletion failed');
        return removed.deleted;
      }));
      deleted += batch.reduce((sum, value) => sum + value, 0);
    }
  }
  return { deleted };
}

module.exports = { cleanupExpired };
