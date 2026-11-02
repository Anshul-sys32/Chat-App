const { randomUUID } = require("node:crypto");
const { pool } = require("../config/db");

const sendMeetingReminders = async (io, now = new Date()) => {
  const toMysqlUtc = (date) => date.toISOString().slice(0, 19).replace("T", " ");
  const reminderLimit = new Date(now.getTime() + 15 * 60 * 1000);
  const [meetings] = await pool.execute(
    `SELECT id, organizer_id AS organizerId, title, description, scheduled_at AS scheduledAt
     FROM scheduled_meetings
     WHERE status = 'scheduled' AND reminder_sent_at IS NULL
       AND scheduled_at > ? AND scheduled_at <= ?`,
    [toMysqlUtc(now), toMysqlUtc(reminderLimit)]
  );
  let sent = 0;
  for (const meeting of meetings) {
    const connection = await pool.getConnection();
    let notifications = [];
    try {
      await connection.beginTransaction();
      const [claimed] = await connection.execute(
        `UPDATE scheduled_meetings SET reminder_sent_at = UTC_TIMESTAMP()
         WHERE id = ? AND status = 'scheduled' AND reminder_sent_at IS NULL`,
        [meeting.id]
      );
      if (!claimed.affectedRows) {
        await connection.rollback();
        continue;
      }
      const [participants] = await connection.execute(
        `SELECT user_id AS userId FROM meeting_participants
         WHERE meeting_id = ? AND status = 'accepted'`,
        [meeting.id]
      );
      const recipients = [...new Set([Number(meeting.organizerId), ...participants.map((row) => Number(row.userId))])];
      if (recipients.length) {
        const batchId = randomUUID();
        const message = `${meeting.title} begins soon.`;
        const values = recipients.flatMap((userId) => [batchId, userId, null, "Meeting reminder", message, "meeting_reminder", "meeting", meeting.id, meeting.title]);
        const placeholders = recipients.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
        await connection.execute(
          `INSERT INTO notifications
           (batch_id, user_id, sender_id, title, body, category, target_type, target_id, target_name)
           VALUES ${placeholders}`,
          values
        );
        [notifications] = await connection.execute(
          `SELECT id AS _id, user_id AS userId, title, body, category, target_type AS targetType,
                  target_id AS targetId, target_name AS targetName, is_read AS isRead, created_at AS timestamp
           FROM notifications WHERE batch_id = ? ORDER BY id`,
          [batchId]
        );
      }
      await connection.commit();
      for (const notification of notifications) io?.in(`user:${notification.userId}`).emit("notification", notification);
      sent += notifications.length;
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }
  return sent;
};

module.exports = { sendMeetingReminders };
