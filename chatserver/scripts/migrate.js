require("dotenv").config();
const { connectDB, pool } = require("../config/db");
const { runMigrations } = require("../utils/migrations");

connectDB()
  .then(runMigrations)
  .then(() => console.log("Database migrations are up to date."))
  .catch((error) => {
    console.error("Database migration failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
