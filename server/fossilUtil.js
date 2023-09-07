import fs from "fs";
import path from "path";

import fossil from "./fossil.js";

/**
 * Adds a file to the repository if not added and / or commits it if it has changes.
 * Used for adding and committing files that have been (re)processed externally (e.g.,
 * by the pipeline) to ensure the changes are tracked in the fossil repository.
 * @param {string} file - The file to add or commit (if necessary).
 * @returns {Promise<?string>} - The commit hash if a commit was made, null otherwise.
 */
const addAndCommit = async (file) => {
  const inRepo = await fossil.isInRepo(file);
  // !inRepo because file will need to be commit after adding (hasChanges would detect
  // the ADDED change, but since we already know it's not in the repo, we can avoid
  // spawning an additional process)
  const needsCommit = !inRepo || (await fossil.hasChanges(file));
  if (!inRepo) {
    await fossil.add(file);
  }
  if (needsCommit) {
    // get the datetime for when the file was updated so the commit reflects the
    // actual time the file was (re)processed
    const mtimeMs = (await fs.promises.stat(file)).mtimeMs;
    // use toISOString because fossil expects YYYY-MM-DDTHH:mm:ss.sssZ (ISO 8601)
    const date = new Date(mtimeMs).toISOString();
    let message = `Reprocess ${path.basename(file)}`;
    if (!inRepo) {
      message = `Process ${path.basename(file)}`;
    }
    // just commit to trunk because it's the main, default branch
    return await fossil.commit(file, { message, branch: "trunk", date });
  }
  return null; // no commit was made, so no commit hash to return
};

const catAnnotations = async (file, { commit, branch = null } = {}) => {
  // the client might have a commit hash from a version entry, but if not, get the
  // commit from the latest version of the file on the specified branch
  if (commit === undefined) {
    await addAndCommit(file); // ensure the latest version of the file is in the repo
    commit = (await fossil.latestVersion(file, { branch })).commit;
  }
  return fossil.cat(file, { checkin: commit });
};

export { addAndCommit, catAnnotations };
export default { addAndCommit, catAnnotations };
