const { pool } = require("../../config/db");

const MAX_WEBHOOKS_PER_MINUTE = 120;

const consumeWebhookRateLimit = async (integrationId) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `DELETE FROM community_integration_webhook_limits
       WHERE integration_id = ? AND window_start < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 DAY)`,
      [integrationId]
    );
    await connection.execute(
      `INSERT IGNORE INTO community_integration_webhook_limits (integration_id, window_start, request_count)
       VALUES (?, DATE_FORMAT(CURRENT_TIMESTAMP, '%Y-%m-%d %H:%i:00'), 0)`,
      [integrationId]
    );
    const [[bucket]] = await connection.execute(
      `SELECT request_count AS requestCount FROM community_integration_webhook_limits
       WHERE integration_id = ? AND window_start = DATE_FORMAT(CURRENT_TIMESTAMP, '%Y-%m-%d %H:%i:00')
       FOR UPDATE`,
      [integrationId]
    );
    if (!bucket || Number(bucket.requestCount) >= MAX_WEBHOOKS_PER_MINUTE) {
      await connection.commit();
      return false;
    }
    await connection.execute(
      `UPDATE community_integration_webhook_limits SET request_count = request_count + 1
       WHERE integration_id = ? AND window_start = DATE_FORMAT(CURRENT_TIMESTAMP, '%Y-%m-%d %H:%i:00')`,
      [integrationId]
    );
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = { MAX_WEBHOOKS_PER_MINUTE, consumeWebhookRateLimit };
