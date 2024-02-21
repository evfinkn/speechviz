import crypto from "crypto";
import path from "path";

import dotenv from "dotenv";

import { isMain } from "./cli.js";
import { speechvizDir } from "./globals.js";
import { write } from "./io.js";

export async function generateEnvFile(envPath, overwrite = false) {
  const env = `# This file stores environment variables for speechviz.
# It contains sensitive information and should NOT be committed to the repository.
# It is automatically generated when it is missing.

# The secret key used to sign the session ID cookie.
# It should be a long, random string.
SESSION_SECRET=${crypto.randomBytes(32).toString("hex")}
`;
  await write(envPath, env, { flags: overwrite ? "w" : "wx" });
  return dotenv.parse(env);
}

let parsed, error;
const envPath = path.join(speechvizDir, ".env");
if (isMain(import.meta.url)) {
  try {
    await generateEnvFile(envPath);
    console.log("Successfully created .env.");
  } catch (error) {
    if (error.code === "EEXIST") {
      console.error(
        ".env already exists. Delete it first and then rerun this script.",
      );
    } else throw error;
  }
} else {
  ({ parsed, error } = dotenv.config({ path: envPath }));
  if (error) {
    if (error.code === "ENOENT") {
      parsed = generateEnvFile(envPath);
    } else throw error;
  }
}

export default parsed;
