const up = async (connection) => {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS community_tasks (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      group_id INT UNSIGNED NOT NULL,
      channel_id INT UNSIGNED NULL,
      created_by INT UNSIGNED NOT NULL,
      assigned_to INT UNSIGNED NULL,
      linked_message_id BIGINT UNSIGNED NULL,
      title VARCHAR(160) NOT NULL,
      description TEXT NOT NULL,
      due_at DATETIME NULL,
      status ENUM('todo', 'in_progress', 'done') NOT NULL DEFAULT 'todo',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX community_tasks_board (group_id, status, due_at, id),
      INDEX community_tasks_assignee (assigned_to, status, due_at),
      CONSTRAINT community_tasks_group_fk FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
      CONSTRAINT community_tasks_channel_fk FOREIGN KEY (channel_id) REFERENCES group_channels(id) ON DELETE SET NULL,
      CONSTRAINT community_tasks_creator_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT community_tasks_assignee_fk FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT community_tasks_message_fk FOREIGN KEY (linked_message_id) REFERENCES group_messages(id) ON DELETE SET NULL
    ) ENGINE=InnoDB
  `);
};

const down = async (connection) => {
  await connection.query("DROP TABLE IF EXISTS community_tasks");
};

module.exports = { up, down };
