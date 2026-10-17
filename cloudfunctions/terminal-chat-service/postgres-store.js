// ExecutePGSql has no parameter binding. Encode every value as a base64 SQL literal;
// SQL structure, identifiers and operators are fixed by this module.
const textValue = value => `convert_from(decode('${Buffer.from(String(value)).toString('base64')}', 'base64'), 'UTF8')`;
const jsonValue = value => `${textValue(JSON.stringify(value))}::jsonb`;
const ERROR_MESSAGES = {
  TC400: [400, '消息参数无效。'], TC403: [403, '会话凭证无效。'], TC404: [404, '会话不存在。'],
  TC409: [409, '消息编号已被使用，请重新输入消息。'], TC410: [410, '会话已过期。'], TC429: [429, '发送太频繁，请稍后再试。'],
};

function createPostgresStore(executeSQL) {
  const rows = async sql => {
    const result = await executeSQL(sql);
    if (!Array.isArray(result.Rows)) return [];
    return result.Rows.map(row => typeof row === 'string' ? JSON.parse(row) : row);
  };
  const documents = async sql => (await rows(sql)).map(row => typeof row[0] === 'string' ? JSON.parse(row[0]) : row[0]);
  return {
    async getSession(id) { return (await documents(`SELECT data::text FROM terminal_chat.sessions WHERE id=${textValue(id)}`))[0] || null; },
    async appendMessage(input) {
      const result = (await documents(`SELECT terminal_chat.append_message(${jsonValue(input)})::text`))[0];
      if (!result) throw new Error('Missing database result');
      if (result.errorCode) {
        const [status, message] = ERROR_MESSAGES[result.errorCode] || [500, '服务暂时不可用，请稍后重试。'];
        throw Object.assign(new Error(message), { status });
      }
      return result;
    },
    async listMessages(sessionId, cursor, limit) {
      if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid query limits');
      return documents(`SELECT data::text FROM terminal_chat.messages WHERE session_id=${textValue(sessionId)} AND sequence>${cursor} ORDER BY sequence ASC LIMIT ${limit}`);
    },
    async setNotification(id, notification) {
      const result = await rows(`UPDATE terminal_chat.messages SET data=jsonb_set(data,'{notification}',${jsonValue(notification)}) WHERE id=${textValue(id)} RETURNING id`);
      if (result.length !== 1) throw new Error('Message was not updated');
    },
    async cleanupExpired(timestamp = Date.now()) {
      if (!Number.isSafeInteger(timestamp)) throw new Error('Invalid cleanup time');
      let deleted = 0;
      for (const table of ['messages', 'sessions']) {
        const result = await rows(`WITH removed AS (DELETE FROM terminal_chat.${table} WHERE id IN (SELECT id FROM terminal_chat.${table} WHERE purge_after<=to_timestamp(${timestamp}/1000.0) ORDER BY purge_after LIMIT 100) RETURNING id) SELECT count(*) FROM removed`);
        deleted += Number(result[0]?.[0] || 0);
      }
      return { deleted };
    },
  };
}
module.exports = { createPostgresStore };
