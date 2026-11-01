const fs = require("node:fs/promises");
const path = require("node:path");
const { pool } = require("../config/db");

const migrationDirectory = path.resolve(__dirname, "../migrations");
const migrationLockName = "chatserver_schema_migrations";

const runMigrations = async () => {
  const connection = await pool.getConnection();
  let lockAcquired = false;
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(120) NOT NULL PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB
    `);
    const [[lock]] = await connection.execute("SELECT GET_LOCK(?, 30) AS acquired", [migrationLockName]);
    if (Number(lock.acquired) !== 1) throw new Error("Could not acquire the database migration lock.");
    lockAcquired = true;

    const [appliedRows] = await connection.execute("SELECT version FROM schema_migrations");
    const appliedVersions = new Set(appliedRows.map((row) => row.version));
    const files = (await fs.readdir(migrationDirectory))
      .filter((name) => /^\d{12}_[a-z0-9_-]+\.js$/i.test(name))
      .sort();

    for (const filename of files) {
      const version = filename.slice(0, -3);
      if (appliedVersions.has(version)) continue;
      const migration = require(path.join(migrationDirectory, filename));
      if (typeof migration.up !== "function") {
        throw new Error(`Migration ${version} does not export an up function.`);
      }
      await migration.up(connection);
      await connection.execute("INSERT INTO schema_migrations (version) VALUES (?)", [version]);
      console.log(`Applied database migration ${version}`);
    }
  } finally {
    if (lockAcquired) {
      await connection.execute("SELECT RELEASE_LOCK(?)", [migrationLockName]).catch((error) => {
        console.error("Could not release database migration lock:", error.message);
      });
    }
    connection.release();
  }
};

module.exports = { runMigrations };
