import * as argon2 from "argon2";
import Database from "better-sqlite3";
import { program } from "commander";

// The isMain function is used to check if the current file
// is the one called on the command line (e.g., "node db.js").
import { isMain } from "./cli.js";

const db = new Database("speechviz.sqlite3");
// This is recommended for better performance. See
// https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md
db.pragma("journal_mode = WAL");
// prettier-ignore
db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )
`).run();

if (isMain(import.meta.url)) {
  const newCmd = program.command("new");
  newCmd.description("add an item to the database");
  newCmd
    .command("user")
    .argument("<username>", "unique username of the user")
    .argument("<password>", "password of the user (will be hashed)")
    .description("add a user to the database")
    .action(async (user, password) => {
      const hash = await argon2.hash(password);
      try {
        db.prepare("INSERT INTO users (user, password) VALUES (?, ?)").run(
          user,
          hash,
        );
        console.log("User added successfully.");
      } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
          console.error(`Username "${user}" is already taken.`);
        } else {
          throw error;
        }
      }
    });

  const deleteCmd = program.command("delete");
  deleteCmd.description("delete an item from the database");
  deleteCmd
    .command("user")
    .argument("<user>", "username of the user to delete")
    .description("delete a user from the database")
    .action((user) => {
      db.prepare("DELETE FROM users WHERE user=?").run(user);
      console.log("User deleted successfully.");
    });

  const listCmd = program.command("list");
  listCmd.description("list items in the database");
  listCmd
    .command("users")
    .description("list all users")
    .action(() => {
      const users = db.prepare("SELECT user FROM users").all();
      console.log(users.map((row) => row.user).join("\n"));
    });

  listCmd
    .command("tables")
    .description("list all tables")
    .action(() => {
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master" +
            " WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        .all();
      console.log(tables.map((row) => row.name).join("\n"));
    });

  program.parseAsync(process.argv);
}

export default db;
