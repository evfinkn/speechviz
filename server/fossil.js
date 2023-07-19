// TODO: maybe cache the versions output so that we don't have to run it every time
//       and then we can re-run when the repo changes (something is committed)

// NOTE: this file uses function declarations instead of function expressions and
//    arrow syntax because function declarations are hoisted and therefore can be
//    used before they are defined
// NOTE: the functions are suffixed with Cmd so that variable names in the functions
//    don't conflict with other functions, e.g., `versions` and `versionsCmd`, `branch`
//    and `branchCmd`, etc.

const path = require("path");
const { spawn } = require("node:child_process");
const readline = require("node:readline");

const dataDir = path.resolve(__dirname, "../data");
const isWindows = require("process").platform === "win32";
const fossilPath = path.resolve(dataDir, isWindows ? "fossil.exe" : "fossil");

const relToDataDir = (file) => {
  if (path.isAbsolute(file)) {
    return path.relative(dataDir, file);
  }
  return file;
};

// this is simpler than a regex with every possible line ending
// /g makes it global so that it matches every line instead of just the first,
// m makes ^ match start of line and $ match end of line
const lineRegex = /^.+$/gm; // matches every non-empty line

// typedefs
/**
 * A line that was matched by `fossil grep`.
 * @typedef {Object} GrepMatchedLine
 * @property {number} lineNumber - The line number of the matched line.
 * @property {!RegExpExecArray} match - The result of calling `RegExp.exec` on the
 *    matched line with the pattern that was passed to `fossil grep`.
 */
/**
 * A file version that was matched by `fossil grep`.
 * @typedef {Object} GrepMatchedFile
 * @property {string} file - The file that matched the pattern.
 * @property {string} artifactId - The artifact ID of the file.
 * @property {string} checkinId - The checkin ID of the file.
 * @property {string} datetime - The datetime of the checkin.
 * @property {!Array<GrepMatchedLine>} lines - The lines that matched the
 *    pattern that was passed to `fossil grep`.
 */
/**
 * An object representing a version of a file.
 * @typedef {Object} VersionEntry
 * @property {string} file - The file name.
 * @property {string} id - The artifact ID of the file at this version. Can be
 *    used to get the contents of the file at this version (see
 *    {@link artifactCmd `fossil artifact`}).
 * @property {string} commit - The checkin ID of the version. This can be used along
 *    with the file name to get the contents of the file at this version (see
 *    {@link catCmd `fossil cat`}).
 * @property {string} branch - The branch of the artifact. Note that the main branch
 *    is called "trunk".
 * @property {string} message - The commit message.
 * @property {string} user - The user that committed the changes.
 * @property {string} datetime - The date and time of the commit. This is in UTC and
 *    has the format "YYYY-mm-dd HH:MM:SS.SSS".
 * @property {number} unixtime - The date and time of the commit in unix time. Unlike
 *    datetime, this is in UTC.
 * @property {!Object<string, ?(string|number)>} tags - The tags and properties of the
 *    commit. Tags are keys with a null value. Properties are keys with a non-null
 *    value.
 */
/**
 * An object representing a change to a file.
 * @typedef {Object} ChangeEntry
 * @property {string} type - The type of change, e.g., "EDITED" or "ADDED".
 * @property {string} file - The name of the file that was changed.
 */

/**
 * An error thrown when a process exits with a non-zero exit code.
 * @extends Error
 */
class ProcessError extends Error {
  /**
   * The command that was run and that failed.
   * @type {string}
   */
  command;
  /**
   * The arguments that were passed to the command.
   * @type {!Array<*>}
   */
  args;
  /**
   * The exit code of the process.
   * @type {number}
   */
  exitCode;
  /**
   * The stdout output of the process.
   * @type {string}
   */
  stdout;
  /**
   * The stderr output of the process.
   * @type {string}
   */
  stderr;

  /**
   * @param {string} command - The command that was run and that failed.
   * @param {!Array<*>} args - The arguments that were passed to the command.
   * @param {number} exitCode - The exit code of the process.
   * @param {string} stdout - The stdout output of the process.
   * @param {string} stderr - The stderr output of the process.
   */
  constructor(command, args, exitCode, stdout, stderr) {
    super(`Command "${command}" exited with code ${exitCode}`);
    this.name = this.constructor.name;
    this.command = command;
    this.args = args;
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

/**
 * Runs a `fossil` command.
 *
 * Note that this function runs with the current working directory set to the
 * `dataDir` directory.
 * @param {!Array<string>} args - The arguments to pass to the command.
 * @param {Object} [options] - Options for the command.
 * @param {boolean} [options.splitLines=false] - Whether to split the output into
 *    lines. `removeNewline` is assumed true if this is true so that the lines don't
 *    have an empty string at the end.
 * @param {boolean} [options.removeNewline=false] - Whether to remove the newline
 *    character from the end of the output, if any. If `splitLines` is true, then
 *    this is assumed true.
 * @returns {Promise<string|!Array<string>>} The output of the command. If `splitLines`
 *    is true, then the output is an array of lines. Otherwise, it is a string. If the
 *    command fails, the promise is rejected with a `ProcessError`. If spawning the
 *    command fails, the promise is rejected with the error.
 */
function fossilCmd(args, { splitLines = false, removeNewline = false } = {}) {
  return new Promise((resolve, reject) => {
    // cwd has to be the directory containing the fossil repo
    const fossil = spawn(fossilPath, args, { cwd: dataDir });
    let stdout = "";
    let stderr = "";
    fossil.stdout.on("data", (data) => (stdout += data));
    fossil.stderr.on("data", (data) => (stderr += data));
    fossil.on("close", (code) => {
      if (code !== 0) {
        reject(new ProcessError("fossil", args, code, stdout, stderr));
      } else if (splitLines) {
        resolve(stdout.match(lineRegex) || []);
      } else if (removeNewline && stdout.endsWith("\n")) {
        resolve(stdout.slice(0, -1));
      } else {
        resolve(stdout);
      }
    });
    fossil.on("error", (err) => reject(err));
  });
}

// create views the queries use (this won't error if they already exist)
// no --readonly because we're creating views, which requires writing to the db
fossilCmd(["sql", ".read ../queries/views.sql"]);

/**
 * Joins multiple regexs into a single regex.
 * Useful because it allows splitting a regex into multiple lines for readability.
 * @param {!Array<RegExp>} regexs - The regexs to join.
 * @param {string} [flags=""] - The flags to pass to the resulting regex.
 * @returns {!RegExp} The joined regex.
 */
const joinRegex = (regexs, flags = "") => {
  return new RegExp(regexs.map((r) => r.source).join(""), flags);
};

const grepHeaderRegex = joinRegex([
  /== /,
  /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}) /, // datetime YYYY-mm-dd HH:MM (group 1)
  /(.*) /, // filename (group 2)
  /(.*) /, // artifact ID (group 3)
  /checkin (.*)/, // checkin ID (group 4)
]);
const grepLineMatchRegex = /(\d+):(.*)/; // line number (group 1), line (group 2)

/**
 * Parses the output of `fossil grep`.
 * `fossil grep` outputs lines in the following format:
 * ```plain
 * == YYYY-mm-dd HH:MM FILENAME ARTIFACT-ID checkin CHECKIN-ID
 * LINE-NUMBER:LINE
 * LINE-NUMBER:LINE
 * ...
 * ```
 * So each matching file is separated by a line starting with `==` and then the
 * filename, artifact ID, and checkin ID. Then each line in the file that matches
 * the pattern is listed with the line number and the line.
 * @param {string} output - The output of `fossil grep`.
 * @param {!RegExp} pattern - The pattern `fossil grep` was run with.
 * @returns {!Array<GrepMatchedFile>} An array of objects containing the file,
 *    artifact ID, checkin ID, datetime, and matched lines. If `output` is the empty
 *    string, this returns an empty array.
 */
function parseGrepOutput(output, pattern) {
  if (output === "") {
    return [];
  }

  // if pattern's global, copy it without the global flag so that calling exec
  // doesn't change the lastIndex (which would cause other calls to exec to fail)
  if (pattern.global) {
    pattern = new RegExp(pattern.source, pattern.flags.replace("g", ""));
  }

  // split the output into each file using the "==" that starts each file match
  // the (?=) is a lookahead so that "==" is included in the split and has the side
  // effect of not putting an empty string at the beginning of the array
  const matches = output.split(/(?===)/);
  return matches.map((match) => {
    const [header, ...lines] = match.split("\n");
    const [, datetime, file, artifactId, checkinId] =
      grepHeaderRegex.exec(header);

    // remove the last line if it's empty (which'll happen)
    if (lines.at(-1) === "") {
      lines.pop();
    }
    const matchedLines = lines.map((line) => {
      const [, lineNumber, matchedLine] = grepLineMatchRegex.exec(line);
      return {
        lineNumber: parseInt(lineNumber),
        match: pattern.exec(matchedLine),
      };
    });

    return {
      file,
      artifactId,
      checkinId,
      datetime,
      lines: matchedLines,
    };
  });
}

/**
 * Runs `fossil grep` on a file.
 * @param {string} file - The file to run `fossil grep` on.
 * @param {!RegExp} pattern - The pattern to run `fossil grep` with.
 * @param {Object} [options] - Options for `fossil grep`.
 * @param {boolean} [options.once=false] - Whether to pass the `--once` flag to
 *    `fossil grep`.
 * @returns {Promise<!Array<GrepMatchedFile>>} A promise that resolves with an
 *    array of objects containing the file, artifact ID, checkin ID, datetime, and
 *    matched lines. If the file doesn't exist, the promise resolves with an empty
 *    array.
 */
async function grepCmd(file, pattern, { once = false } = {}) {
  const args = ["grep", pattern.source, file];
  if (once) {
    args.push("--once");
  }
  const output = await fossilCmd(args);
  return parseGrepOutput(output, pattern);
}

// FIXME: this probably doesn't need to return anything
/**
 * Adds a file to the repository using `fossil add`.
 * @param {string} file - The file to add. It can be an absolute path or a path
 *    relative to the speechviz/data directory.
 * @returns {Promise<string>} A promise that resolves with the output of the command.
 */
function addCmd(file) {
  // note: fossil add works correctly even if file is an absolute path
  return fossilCmd(["add", file]);
}

/**
 * Commits a file to the repository using `fossil commit`.
 * @param {string} file - The file to commit. It can be an absolute path or a path
 *    relative to the speechviz/data directory.
 * @param {Object} options - Options for the command.
 * @param {string} [options.message="Automatic commit by fossil.js"] - The commit
 *    message.
 * @param {string} [options.user="fossil.js"] - The user to commit as.
 * @param {?string} options.branch - The branch to commit to. If `null`, the 'trunk'
 *    branch will be used. If the branch doesn't exist, it will be created.
 * @param {?string} options.version - The version to tag the commit with. If `null`,
 *    no version tag will be added.
 * @param {?(string[]|Object<string, string>)} options.tags - The tags to add to the
 *    commit. If `null`, no tags will be added. If an array, each tag will be added
 *    with no value. If an object, each key will be added as a tag with the value
 *    being the value of the key (or no value if the value is `null`).
 * @param {?string} options.date - The date and time to use for the commit. If
 *    `null`, the current date and time will be used.
 * @returns {Promise<string>} A promise that resolves to the commit hash.
 */
async function commitCmd(
  file,
  {
    message = "Automatic commit by fossil.js",
    user = "fossil.js",
    branch = null,
    version = null,
    tags = null,
    datetime = null,
  } = {}
) {
  // note: fossil commit works correctly even if file is an absolute path
  const args = ["commit", "-m", `"${message}"`, "--user-override", user, file];
  if (tags !== null) {
    // tags without values can be passed as options
    if (Array.isArray(tags)) {
      tags.forEach((tag) => args.push("--tag", tag));
      // set tags to {} so that later we don't need special handling for when it's an
      // array and version isn't null
      tags = {};
    } else {
      // filter out null values to pass as options to the command
      // the rest will be added later using tag.add (--tag doesn't support values)
      const noValueTags = Object.entries(tags).filter(
        ([, value]) => value === null
      );
      noValueTags.forEach((tag) => {
        args.push("--tag", tag);
        delete tags[tag]; // remove the tag so that we don't need to filter later
      });
    }
  } else {
    tags = {};
  }
  // FIXME: this doesn't work if the ancestor commit is more recent than date
  //        It could be fixed using --allow-older but I'm not sure I want that
  // if (datetime !== null) {
  //   args.push("--date-override", datetime);
  // }
  let output;
  const _commit = async () => {
    output = await fossilCmd(args, { removeNewline: true });
  };
  if (branch === null) {
    await _commit();
  } else {
    const branches = await branchCmd.list();
    if (branches.current === branch) {
      // if the branch is the current branch, we can just commit without switching
      await _commit();
    } else if (!branches.includes(branch)) {
      // --branch only works if the branch doesn't exist
      // we still need to switch back to the original branch after committing, but it's
      // easier than creating the branch and then using withBranch (which might not
      // work anyways since fossil branch new leaves you on the new branch I think)
      const originalBranch = await branchCmd.current();
      args.push("--branch", branch);
      await _commit();
      // switch back to original branch after committing (commit stays on new branch)
      await updateCmd(originalBranch);
    } else {
      // use withBranch to switch to the branch, commit, and switch back
      await withBranch(branch, _commit);
    }
  }
  // fossil commit outputs "New_Version: ARTIFACT-ID" so substring to get the id
  const commitId = output.substring(13);
  if (version !== null) {
    tags.version = version;
  }
  // add tags with values to the commit
  await Promise.all(
    // use map instead of forEach so that we get an array of promises to await
    Object.entries(tags).map(([name, value]) => {
      return tagCmd.add(name, commitId, value, { user, datetime });
    })
  );
  return commitId;
}

/**
 * Contains subcommands for `fossil tag` to control tags and properties.
 * @namespace
 * @see https://fossil-scm.org/home/help?cmd=tag
 */
var tagCmd = {
  /**
   * Adds a tag to a checkin using `fossil tag add`.
   * @param {string} name - The name of the tag.
   * @param {string} checkinId - The ID of the checkin to tag.
   * @param {?string} value - The value of the tag.
   * @param {Object} options - Options for the command.
   * @param {boolean} [options.raw=false] - Whether to pass the `--raw` flag.
   * @param {boolean} [options.propagate=false] - Whether to pass the `--propagate`
   *    flag.
   * @param {?string} options.datetime - The date and time to use for when the tag was
   *    added. If `null`, the current date and time will be used.
   * @param {string} [options.user="fossil.js"] - The user to add the tag as.
   * @returns {Promise<void>} A promise that resolves when the command is finished.
   */
  async add(
    name,
    checkinId,
    value = null,
    { raw = false, propagate = false, user = "fossil.js" } = {}
  ) {
    const args = ["tag", "add", name, checkinId];
    if (value !== null) {
      // null is a valid value but passing it makes it a string, hence the if statement
      args.push(value);
    }
    if (raw) {
      args.push("--raw");
    }
    if (propagate) {
      args.push("--propagate");
    }
    // FIXME: this doesn't work if the ancestor commit is more recent than date
    //        It could be fixed using --allow-older but I'm not sure I want that
    // if (datetime !== null) {
    //   args.push("--date-override", datetime);
    // }
    if (user !== null) {
      args.push("--user-override", user);
    }
    await fossilCmd(args);
  },

  /**
   * Runs `fossil tag cancel` to remove a tag from a checkin.
   * @param {string} name - The name of the tag to remove. Note that the name doesn't
   * need to be prefixed with `sym-` unlike when using `fossil tag add`.
   * @param {string} checkinId - The ID of the checkin to remove the tag from.
   * @param {Object} options - Options for the command.
   * @param {boolean} [options.raw=false] - Whether to pass the `--raw` flag.
   * @param {?string} options.date - The date and time to use for when the tag was
   *    removed. If `null`, the current date and time will be used.
   * @param {string} [options.user="fossil.js"] - The user to remove the tag as.
   * @returns {Promise<void>} A promise that resolves when the command is finished.
   */
  async cancel(name, checkinId, { raw = false, user = "fossil.js" } = {}) {
    const args = ["tag", "cancel", name, checkinId];
    if (raw) {
      args.push("--raw");
    }
    // FIXME: this doesn't work if the ancestor commit is more recent than date
    //        It could be fixed using --allow-older but I'm not sure I want that
    // if (date !== null) {
    //   args.push("--date-override", date);
    // }
    if (user !== null) {
      args.push("--user-override", user);
    }
    await fossilCmd(args);
  },

  /**
   * Runs `fossil tag find` to find checkins using a tag.
   *
   * Note that the command is run with the `--raw` flag.
   * @param {string} name - The name of the tag.
   * @param {Object} options - Options for the command.
   * @param {?number} options.limit - The maximum number of checkins to return. If
   *    `null`, all checkins will be returned.
   * @param {boolean} [options.prefixSym=true] - Whether to prefix the tag name with
   *    `sym-` before running the command. User-added tags are prefixed with `sym-`
   *    by fossil, so this needs to be `true` unless you're searching for a tag that
   *    was added internally by fossil.
   * @returns {Promise<string[]>} A promise that resolves to an array of artifact IDs.
   *    If no checkins are found, the promise resolves to an empty array.
   */
  async find(name, { limit = null, prefixSym = true } = {}) {
    if (prefixSym) {
      name = `sym-${name}`;
    }
    const args = ["tag", "find", "--raw", name];
    if (limit !== null) {
      args.push("--limit", limit);
    }
    return await fossilCmd(args, { splitLines: true });
  },

  /**
   * Lists tags using `fossil tag list`.
   * @param {?string} checkinId - The ID of the checkin to list tags for. If `null`,
   *    all tag names will be returned. Otherwise, the checkin's tags and values will
   *    be returned.
   * @param {Object} options - Options for the command.
   * @param {boolean} [options.raw=false] - Whether to pass the `--raw` flag.
   * @param {?("cancel"|"singleton"|"propagate")} options.type - The type of tags
   *    to list. If `null`, all tags will be listed.
   * @param {boolean} [options.inverse=false] - Whether to pass the `--inverse` flag.
   * @param {?string} options.prefix - The prefix to filter tags by. If `null`, all
   *    tags will be returned.
   * @param {boolean} [options.parseNums=true] - Whether to parse numbers in tag values.
   *    Only applies if `checkinId` is not `null`. Numbers are parsed using
   *    `parseFloat`.
   * @returns {Promise<string[]|Object<string, string>>} If `checkinId` is `null`, a
   *    promise that resolves to an array of tag names. Otherwise, a promise that
   *    resolves to an object mapping tag names to values. If no tags are found, the
   *    promise resolves to an empty array or object.
   */
  async list(
    checkinId = null,
    {
      raw = false,
      type = null,
      inverse = false,
      prefix = null,
      parseNums = true,
    } = {}
  ) {
    const args = ["tag", "list"];
    if (checkinId !== null) {
      args.push(checkinId);
    }
    if (raw) {
      args.push("--raw");
    }
    if (type !== null) {
      args.push("--type", type);
    }
    if (inverse) {
      args.push("--inverse");
    }
    if (prefix !== null) {
      args.push("--prefix", prefix);
    }
    const lines = await fossilCmd(args, { splitLines: true });
    if (checkinId === null) {
      return lines; // if uuid is null, only tag names are output
    }
    const tags = {};
    lines.forEach((line) => {
      // tags without a value are returned as "tagname"
      // tags with a value are returned as "tagname=value"
      let [tagname, value = null] = line.split("="); // eslint-disable-line prefer-const
      if (parseNums && value !== null) {
        const num = parseFloat(value);
        if (!isNaN(num)) {
          value = num;
        }
      }
      tags[tagname] = value;
    });
    return tags;
  },
};

// "" if not current or "*" if current (group 1), branch name (group 2)
const branchListLineRegex = /^\s+(\*?)\s+(.*)/;

/**
 * Contains subcommands for `fossil branch` to manage branches.
 * @namespace
 * @see https://fossil-scm.org/home/help?cmd=branch
 */
var branchCmd = {
  /**
   * Runs `fossil branch current` to get the name of the current branch.
   * @returns {Promise<string>} A promise that resolves to the name of the current
   *    branch.
   */
  async current() {
    return await fossilCmd(["branch", "current"], { removeNewline: true });
  },

  /**
   * Runs `fossil branch list` to get a list of branches.
   * @returns {Promise<string[]>} A promise that resolves to an array of branch names.
   *    The array has a `current` property that is the name of the current branch.
   */
  async list() {
    const lines = await fossilCmd(["branch", "list"], { splitLines: true });
    // the lines start with white space (and an asterisk if the branch is current)
    // so we remove that to get the branch names
    let current;
    const branchesList = lines.map((line) => {
      const match = branchListLineRegex.exec(line);
      // match[1] is either "" or "*", match[2] is the branch name
      if (match[1] === "*") {
        current = match[2];
      }
      return match[2];
    });
    branchesList.current = current;
    return branchesList;
  },
};

const stashIdRegex = /stash (\d+) saved/;

/**
 * Contains subcommands for `fossil stash`.
 * @namespace
 * @see https://fossil-scm.org/home/help?cmd=stash
 */
var stashCmd = {
  /**
   * Saves changes to the stash using `fossil stash save`.
   * @param {string[]} [files=[]] - The files to stash or ignore. If `inverse` is
   *    `true`, these will be files to ignore instead of files to stash. If `files` is
   *    empty, all changes will be stashed, regardless of `inverse`'s value. The files
   *    can be absolute paths or paths relative to the speechviz/data directory.
   * @param {Object} [options={}] - Options for the command.
   * @param {boolean} [options.inverse=false] - If `true`, the `files` argument will
   *    act as a list of files to ignore instead of a list of files to stash.
   * @param {string} [options.message="Stashed by fossil.js"] - The message to use for
   *    the stash.
   * @returns {Promise<number>} A promise that resolves to the stash ID.
   */
  async save(
    files = [],
    { inverse = false, message = "Stashed by fossil.js" } = {}
  ) {
    // note: fossil stash works correctly even if the files are absolute paths
    if (inverse) {
      const changed = await changesCmd();
      files = changed.filter((file) => !files.includes(file));
    }
    const args = ["stash", "save", "-m", `"${message}"`];
    const output = await fossilCmd(args);
    const match = output.match(stashIdRegex);
    return parseInt(match[1]);
  },

  /** Runs `fossil stash pop` to pop the most recent stash. */
  pop() {
    return fossilCmd(["stash", "pop"]);
  },

  /**
   * Runs `fossil stash apply` to apply a stash.
   * @param {number} stashId - The ID of the stash to apply.
   */
  apply(stashId) {
    return fossilCmd(["stash", "apply", stashId]);
  },

  /**
   * Runs `fossil stash goto`, which updates to the baseline checkout for the stash and
   * then applies it.
   */
  goto(stashId) {
    return fossilCmd(["stash", "goto", stashId]);
  },
};

/**
 * Runs the given callback with changes to the given files stashed.
 *
 * The changes are stashed using `fossil stash save` and then applied after the
 * callback is run.
 * @param {Function} callback - The callback to run.
 * @param {string[]} [files=[]] - The files to stash or ignore.
 * @param {Object} [options={}] - Options for the stash save command.
 * @see stashCmd.save
 */
async function withStash(callback, files = [], options = {}) {
  const stashId = await stashCmd.save(files, options);
  await callback();
  await stashCmd.apply(stashId);
}

// TODO: right now this is limited functionality of `fossil update`
/**
 * Updates to the given version using `fossil update`.
 * @param {string} version - The version to update to. This can be a tag, branch, or
 *    checkin ID.
 * @param {Object} [options={}] - Options for the command.
 * @param {boolean} [options.setmtime=false] - If `true`, the mtime of all files will
 *    be updated to match the timestamp of the checkin that they were last changed in.
 */
function updateCmd(version, { setmtime = false } = {}) {
  const args = ["update", version];
  if (setmtime) {
    args.push("--setmtime");
  }
  return fossilCmd(args);
}

/**
 * Runs the given callback with the given branch checked out.
 *
 * The branch is checked out using `fossil update` and then the original branch is
 * checked out after the callback is run.
 * @param {string} branch - The branch to check out.
 * @param {Function} callback - The callback to run.
 * @see updateCmd
 */
async function withBranch(branch, callback) {
  const originalBranch = await branchCmd.current();
  await updateCmd(branch);
  await callback();
  await updateCmd(originalBranch);
}

function catCmd(file, { checkin = null } = {}) {
  const args = ["cat", file];
  if (checkin) {
    args.push("-r", checkin);
  }
  return fossilCmd(args);
}

/**
 * Returns the contents of an artifact using `fossil artifact`.
 * @param {string} artifactId - The artifact ID of the file.
 * @returns {Promise<string>} A promise that resolves to the file contents.
 */
function artifactCmd(artifactId) {
  return fossilCmd(["artifact", artifactId]);
}

const changesFileRegex = /(\S+)\s+(\S+)/; // matches the change type and file name

/**
 * Runs `fossil changes` to get a list of changed files.
 * @param {Object} options - Options for the command.
 * @param {string[]} [options.files=[]] - The files to check for changes. If empty,
 *    all files will be checked. The files can be absolute paths or paths relative to
 *    the speechviz/data directory.
 * @param {boolean} [options.classify=false] - Whether the output should include the
 *    change type.
 * @returns {Promise<(!Array<string>|!Array<ChangeEntry>)>} A promise that resolves
 *    with an array of changed files. If `classify` is `false`, the array will contain
 *    strings of the file names. Otherwise, the array will contain objects containing
 *    the change type and file name.
 */
async function changesCmd({ files = [], classify = false } = {}) {
  // note: fossil changes works correctly even if the files are absolute paths
  const args = ["changes", ...files];
  // no case for classify = true because it's the default
  if (!classify) {
    args.push("--no-classify");
  }
  const lines = await fossilCmd(args, { splitLines: true });
  if (lines.length === 0) {
    return lines;
  }
  if (!classify) {
    return lines;
  }
  return lines.map((line) => {
    const [, type, file] = changesFileRegex.exec(line);
    return { type, file };
  });
}

/**
 * Returns whether there are any changes in the repository.
 * @param {...string} files - The files to check for changes. If empty, all files will
 *    be checked.
 * @returns {Promise<boolean>} A promise that resolves to `true` if there are changes
 *    and `false` otherwise.
 */
async function hasChanges(...files) {
  const changes = await changesCmd({ files });
  return changes.length > 0;
}

/**
 * Runs a `fossil` query to get the version history of a file.
 * @param {string} file - The file to get the version history for. It should be a path
 *    relative to the speechviz/data directory. If it is not, it will be converted to
 *    one.
 * @param {Object} options - Options for the command.
 * @param {?string} options.branch - The branch to get the version history for.
 *    If `null`, every branch will be included.
 * @param {number} [options.limit=-1] - The maximum number of versions to get. -1 is
 *    equivalent to no limit. Note that if `branch` is `null`, this limit will not be
 *    applied to each branch individually.
 * @param {boolean} [options.parseNums=true] - Whether to parse numbers in tag values.
 *    Only applies if `uuid` is not `null`. Numbers are parsed using `parseFloat`.
 * @returns {Promise<VersionEntry[]>} A promise that resolves to an array of
 *    VersionEntry objects. If the `fossil sql` command fails, the promise is rejected
 *    with a `ProcessError`. If spawning the command fails, the promise is rejected
 *    with the error.
 */
function versionsCmd(
  file,
  { branch = null, limit = -1, parseNums = true } = {}
) {
  // FIXME: do something if versions not in repo?
  // file has to be relative to the directory the repository is in since that's the
  // path stored in the database
  file = relToDataDir(file);
  return new Promise((resolve, reject) => {
    // this outputs a JSON string that can be parsed into a VersionEntry object (without
    // the file property)
    const args = [
      "sql",
      "--readonly",
      ".mode list", // prevents the JSON object output from being single-quoted
      `.param set :file '${file}'`,
      // SQL parses 'null' as NULL, so this still works when selecting all branches
      `.param set :branch '${branch}'`,
      `.param set :limit '${limit}'`,
      ".read ../queries/getVersions.sql",
    ];
    const fossil = spawn(fossilPath, args, { cwd: dataDir });

    let stderr = "";
    fossil.stderr.on("data", (data) => (stderr += data));
    // we want to read the output line by line because each line is a JSON string
    const rl = readline.createInterface({
      input: fossil.stdout,
      terminal: false,
    });

    const entries = [];
    rl.on("line", (line) => {
      const entry = JSON.parse(line);

      if (parseNums) {
        Object.entries(entry.tags).forEach(([key, value]) => {
          const num = parseFloat(value);
          if (!isNaN(num)) {
            entry.tags[key] = num;
          }
        });
      }

      // // define version as a getter for entry.tags.version
      // Object.defineProperty(entry, "version", {
      //   get: () => entry.tags.version,
      //   set: (value) => (entry.tags.version = value),
      // });
      // entry.version = entry.tags.version;

      entries.push(entry);
    });
    fossil.on("close", (code) => {
      if (code !== 0) {
        const stdout = entries.map((entry) => JSON.stringify(entry)).join("\n");
        reject(new ProcessError("fossil", args, code, stdout, stderr));
      }
      resolve(entries);
    });
    fossil.on("error", (err) => reject(err));
  });
}

/**
 * Checks if a file has been added to the repository using `fossil add`.
 * @param {string} file - The file to check. It can be an absolute path or a path
 *    relative to the speechviz/data directory.
 * @returns {Promise<boolean>}
 */
async function isInRepo(file) {
  // `fossil finfo` will fail if the file doesn't exist or isn't in the repo
  try {
    await fossilCmd(["finfo", file]);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Gets the next version number for a file.
 *
 * The next version of `file` is the version number of the latest version on `branch`
 * plus 1. If `file` has no previous versions, the next version is 1.
 * @param {string} file - The file to get the next version for. It should be a
 *    path relative to the speechviz/data directory. If it is not, it will be converted
 *    to one.
 * @param {?string} [branch="trunk"] - The branch to get the next version for.
 * @returns {Promise<number>} A promise that resolves to the next version number. If
 *    the file has no previous versions, the promise resolves to 1.
 */
// async function getNextVersionNum(file, branch = "trunk") {
//   const versions = await versionsCmd(file, {
//     branch,
//     version: "latest",
//   });
//   if (versions.length === 0 || versions[0].version === undefined) {
//     return 1;
//   }
//   return versions[0].version + 1;
// }

module.exports = {
  add: addCmd,
  commit: commitCmd,
  branch: branchCmd,
  update: updateCmd,
  withBranch,
  tag: tagCmd,
  stash: stashCmd,
  withStash,
  changes: changesCmd,
  hasChanges,
  artifact: artifactCmd,
  cat: catCmd,
  grep: grepCmd,
  versions: versionsCmd,
  // getNextVersionNum,
  isInRepo,
};
