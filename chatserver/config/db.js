const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

const connectDB = async () => {
  const connection = await pool.getConnection();
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NULL,
        google_sub VARCHAR(255) NULL,
        google_name VARCHAR(255) NULL,
        google_picture VARCHAR(2048) NULL,
        role ENUM('user', 'moderator', 'admin', 'guest') NOT NULL DEFAULT 'user',
        status ENUM('active', 'pending', 'suspended', 'inactive') NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB
    `);
    for (const [column, definition] of [
      ["google_sub", "VARCHAR(255) NULL"],
      ["google_name", "VARCHAR(255) NULL"],
      ["google_picture", "VARCHAR(2048) NULL"],
    ]) {
      const [columns] = await connection.execute(
        `SELECT COUNT(*) AS count FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = ?`,
        [column]
      );
      if (!columns[0].count) {
        await connection.query(`ALTER TABLE users ADD COLUMN ${column} ${definition}`);
      }
    }
    const [googleSubjectIndex] = await connection.execute(
      `SELECT COUNT(*) AS count FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND table_name = 'users' AND index_name = 'users_google_sub_unique'`
    );
    if (!googleSubjectIndex[0].count) {
      await connection.query("ALTER TABLE users ADD UNIQUE INDEX users_google_sub_unique (google_sub)");
    }
    const [passwordColumn] = await connection.execute(
      `SELECT IS_NULLABLE AS nullable FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'password'`
    );
    if (passwordColumn[0]?.nullable === "NO") {
      await connection.query("ALTER TABLE users MODIFY password VARCHAR(255) NULL");
    }
    await connection.query(
      "ALTER TABLE users MODIFY status ENUM('active', 'pending', 'suspended', 'inactive') NOT NULL DEFAULT 'pending'"
    );
    await connection.query("UPDATE users SET status = 'suspended' WHERE status = 'inactive'");
    await connection.query(
      "ALTER TABLE users MODIFY status ENUM('active', 'pending', 'suspended') NOT NULL DEFAULT 'pending'"
    );
    await connection.query(`
      UPDATE users u
      JOIN (
        SELECT username, MIN(id) AS keep_id
        FROM users
        GROUP BY username
        HAVING COUNT(*) > 1
      ) duplicates ON duplicates.username = u.username AND u.id <> duplicates.keep_id
      SET u.username = CONCAT(LEFT(u.username, 70), '-', u.id, '-', LEFT(SHA2(CONCAT(u.id, ':', u.username), 256), 8))
    `);
    const [usernameIndex] = await connection.execute(
      `SELECT COUNT(*) AS count FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND table_name = 'users' AND index_name = 'users_username_unique'`
    );
    if (!usernameIndex[0].count) {
      await connection.query("ALTER TABLE users ADD UNIQUE INDEX users_username_unique (username)");
    }
    await connection.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        sender_id INT UNSIGNED NOT NULL,
        receiver_id INT UNSIGNED NOT NULL,
        content TEXT NOT NULL,
        attachments JSON NULL,
        is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX messages_conversation (sender_id, receiver_id, created_at),
        CONSTRAINT messages_sender_fk FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT messages_receiver_fk FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    const [messageDeletedColumn] = await connection.execute(
      `SELECT COUNT(*) AS count FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'messages' AND column_name = 'is_deleted'`
    );
    if (!messageDeletedColumn[0].count) {
      await connection.query("ALTER TABLE messages ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE");
    }
    const [messageAttachmentsColumn] = await connection.execute(
      `SELECT COUNT(*) AS count FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'messages' AND column_name = 'attachments'`
    );
    if (!messageAttachmentsColumn[0].count) {
      await connection.query("ALTER TABLE messages ADD COLUMN attachments JSON NULL");
    }
    await connection.query(`
      CREATE TABLE IF NOT EXISTS chat_groups (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        created_by INT UNSIGNED NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT chat_groups_creator_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS group_members (
        group_id INT UNSIGNED NOT NULL,
        user_id INT UNSIGNED NOT NULL,
        role ENUM('admin', 'member') NOT NULL DEFAULT 'member',
        PRIMARY KEY (group_id, user_id),
        CONSTRAINT group_members_group_fk FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
        CONSTRAINT group_members_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    const [membershipRoleColumn] = await connection.execute(
      `SELECT COUNT(*) AS count FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'group_members' AND column_name = 'role'`
    );
    if (!membershipRoleColumn[0].count) {
      await connection.query(
        "ALTER TABLE group_members ADD COLUMN role ENUM('admin', 'member') NOT NULL DEFAULT 'member'"
      );
      await connection.query(`
        UPDATE group_members gm
        JOIN chat_groups g ON g.id = gm.group_id AND g.created_by = gm.user_id
        SET gm.role = 'admin'
      `);
    }
    await connection.query(`
      CREATE TABLE IF NOT EXISTS group_messages (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        group_id INT UNSIGNED NOT NULL,
        sender_id INT UNSIGNED NOT NULL,
        content TEXT NOT NULL,
        attachments JSON NULL,
        is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX group_messages_history (group_id, created_at, id),
        CONSTRAINT group_messages_group_fk FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
        CONSTRAINT group_messages_sender_fk FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    const [groupMessageDeletedColumn] = await connection.execute(
        `SELECT COUNT(*) AS count FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'group_messages' AND column_name = 'is_deleted'`
    );
    if (!groupMessageDeletedColumn[0].count) {
        await connection.query("ALTER TABLE group_messages ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE");
    }
    const [groupMessageAttachmentsColumn] = await connection.execute(
        `SELECT COUNT(*) AS count FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'group_messages' AND column_name = 'attachments'`
    );
    if (!groupMessageAttachmentsColumn[0].count) {
        await connection.query("ALTER TABLE group_messages ADD COLUMN attachments JSON NULL");
    }
    await connection.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        batch_id CHAR(36) NOT NULL,
        user_id INT UNSIGNED NOT NULL,
        sender_id INT UNSIGNED NULL,
        title VARCHAR(120) NOT NULL,
        body TEXT NOT NULL,
        is_read BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX notifications_user_history (user_id, created_at, id),
        INDEX notifications_user_unread (user_id, is_read),
        INDEX notifications_batch (batch_id),
        CONSTRAINT notifications_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT notifications_sender_fk FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB
    `);
  } finally {
    connection.release();
  }
  console.log("MySQL connected and schema ready");
};

module.exports = { connectDB, pool };
