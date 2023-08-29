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

// fossil.js is in speechviz/server, hence the ../ to get to speechviz/data
const dataDir = path.resolve(__dirname, "../data");
// platform is "win32" even on 64-bit Windows
const isWindows = require("process").platform === "win32";
const fossilPath = path.resolve(dataDir, isWindows ? "fossil.exe" : "fossil");

// This is much simpler than a regex with every possible line ending.
// /g makes it global so that it matches every line instead of just the first
// /m makes ^ match start of line and $ match end of line instead of start/end of string
/**
 * `RegExp` that can be used with `String.prototype.match` to get every non-empty line
 * in a string.
 *
 * Matches exclude the newline character(s) at the end of the line.
 * @type {RegExp}
 */
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
 * @property {string} file - The name of the file whose content matched the pattern.
 * @property {string} id - The artifact ID of the specific version of the file.
 * @property {string} commit - The checkin ID of the specific version of the file.
 * @property {string} datetime - The date and time of the commit.
 * @property {!GrepMatchedLine[]} lines - The lines that matched the
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
 * @property {number} unixtime - The date and time of the commit in unix time. This is
 *    in UTC.
 * @property {!Object<string, ?(string|number)>} tags - The tags and properties of the
 *    commit. Tags are keys with a null value. Properties are keys with a non-null
 *    value.
 */

// callbacks
/**
 * @callback withStashCallback
 * @param {number} stashId - The ID of the stash.
 */
/**
 * @callback withBranchCallback
 * @param {string} originalBranch - The original branch.
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
   * @type {!any[]}
   */
  args;
  /**
   * The exit code of the process.
   * @type {number}
   */
  exitCode;
  /**
   * The stdout output of the process.
   *
   * This will be an empty string if the process did not output anything to stdout.
   * @type {string}
   */
  stdout;
  /**
   * The stderr output of the process.
   *
   * This will be an empty string if the process did not output anything to stderr.
   * @type {string}
   */
  stderr;

  /**
   * @param {string} command - The command that was run and that failed.
   * @param {!any[]} args - The arguments that were passed to the command.
   * @param {number} exitCode - The exit code of the process.
   * @param {string} stdout - The stdout output of the process.
   * @param {string} stderr - The stderr output of the process.
   */
  constructor(command, args, exitCode, stdout, stderr) {
    const message =
      "Process exited with non-zero exit code." +
      `\nCommand: ${command} ${args.join(" ")}` +
      `\nExit code: ${exitCode}` +
      `\nstdout: ${stdout === "" ? "none" : stdout}` +
      `\nstderr: ${stderr}`;
    super(message);
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
 * @param {!any[]} args - The arguments to pass to the command. This should
 *    not include "fossil".
 * @param {Object} options - Options for the command.
 * @param {boolean} [options.splitLines=false] - Whether to split the output into
 *    lines. `removeNewline` is assumed true if this is true so that the lines don't
 *    have an empty string at the end.
 * @param {boolean} [options.removeNewline=false] - Whether to remove the newline
 *    character from the end of the output, if any. If `splitLines` is true, then
 *    this is assumed true.
 * @returns {!Promise<(string|!string[])>} The output of the command. If `splitLines`
 *    is true, then the output is an array of lines. Otherwise, it is a string. If the
 *    command fails, the promise is rejected with a `ProcessError`. If spawning the
 *    command fails, the promise is rejected with the error.
 */
function fossilCmd(args, { splitLines = false, removeNewline = false } = {}) {
  return new Promise((resolve, reject) => {
    // cwd has to be the directory containing the checkout of the fossil repo because
    // fossil leaves a .fslckout file in that directory to identify it
    const fossil = spawn(fossilPath, args, { cwd: dataDir });
    let stdout = "";
    let stderr = ""; // store stderr in case need to create ProcessError
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

/**
 * Runs `fossil sql` with the given SQL.
 * @param {(string|!string[])} statements - The SQL statements to run. If this is a
 *    string, then it is considered a single statement. The statements are appended to
 *    the command after necessary options are added.
 * @param {!Object<string, ?any>} [params={}] - The parameters to pass to the SQL.
 *    The keys are the parameter names and the values are the parameter values. The
 *    parameter names must start with "$" or ":" (and if they don't, they will be
 *    prepended with ":"). If a parameter value is `undefined`, then it will be passed
 *    as `null` to sqlite.
 * @param {Object} options - Options for the command.
 * @param {string} [options.mode="list"] - The mode to use for the output. This is
 *    passed to sqlite's `.mode` dot command.
 * @param {boolean} [options.readonly=true] - Whether to open the database in read-only
 *    mode. Passed as `--readonly` to `fossil sql`.
 */
function sqlCmd(
  statements,
  params = {},
  { mode = "list", readonly = true, splitLines = true } = {}
) {
  const args = ["sql"];
  if (readonly) {
    args.push("--readonly");
  }
  args.push(`.mode ${mode}`);
  Object.entries(params).forEach(([key, value]) => {
    if (!key.startsWith("$") && !key.startsWith(":")) {
      // allow not having $ or : at the beginning of the parameter name to simplify
      // passing in the params object
      key = `:${key}`; // parameter names must start with $ or :
      // (note that sqlite says params can start with @, but I'm pretty
      // sure when I tried it, it didn't work)
    }
    if (value === undefined) {
      // sqlite doesn't have undefined, so use null (which was probably intended anyway)
      value = null;
    }
    args.push(`.param set ${key} ${value}`);
  });
  if (Array.isArray(statements)) {
    args.push(...statements);
  } else {
    args.push(statements); // assume string
  }
  return fossilCmd(args, { splitLines });
}

// Create views the queries use (this won't error if they already exist).
// no --readonly because we're creating views, which requires writing to the db
sqlCmd(".read ../queries/views.sql", { readonly: false });

/**
 * Joins multiple regexs into a single regex.
 * Useful because it allows splitting a regex into multiple lines for readability.
 * @param {!RegExp[]} regexs - The regexs to join.
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
 *
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
 * @returns {!GrepMatchedFile[]} An array of objects representing each file
 *    that matched the pattern.
 */
function parseGrepOutput(output, pattern) {
  if (output === "") {
    return [];
  }

  // if pattern is global, copy it without the global flag so that calling exec
  // doesn't change the lastIndex (which would cause other calls to exec to fail)
  if (pattern.global) {
    pattern = new RegExp(pattern.source, pattern.flags.replace("g", ""));
  }

  // Split the output into each file using the "==" that starts each file match.
  // The (?=) is a lookahead so that "==" is included in the split and has the side
  // effect of not putting an empty string at the beginning of the array.
  const matches = output.split(/(?===)/);
  return matches.map((match) => {
    const [header, ...lines] = match.match(lineRegex); // split the file into lines
    // skip the first item in the array because it's the whole match
    const [, datetime, file, id, commit] = grepHeaderRegex.exec(header);

    const matchedLines = lines.map((line) => {
      const [, lineNumber, matchedLine] = grepLineMatchRegex.exec(line);
      return {
        lineNumber: parseInt(lineNumber),
        match: pattern.exec(matchedLine),
      };
    });

    return { file, id, commit, datetime, lines: matchedLines };
  });
}

/**
 * Runs `fossil grep` on a file.
 * @param {string} file - The file to run `fossil grep` on.
 * @param {!RegExp} pattern - The pattern to run `fossil grep` with.
 * @param {Object} options - Options for `fossil grep`.
 * @param {boolean} [options.once=false] - Whether to pass the `--once` flag to
 *    `fossil grep`.
 * @returns {!Promise<!GrepMatchedFile[]>} A promise that resolves with an
 *    array of objects containing the file, artifact ID, checkin ID, datetime, and
 *    matched lines. If the file doesn't exist, the promise resolves with an empty
 *    array.
 * @see https://fossil-scm.org/home/help?cmd=grep
 */
async function grepCmd(file, pattern, { once = false } = {}) {
  const args = ["grep", pattern.source, file];
  if (once) {
    args.push("--once");
  }
  // don't need to removeNewline or splitLines because parseGrepOutput does that
  const output = await fossilCmd(args);
  return parseGrepOutput(output, pattern);
}

/**
 * Adds a file to the repository using `fossil add`.
 * @param {(string|!string[])} files - The files to add. They can be absolute paths
 *    or paths relative to the speechviz/data directory. If a string is passed in, only
 *    it will be added.
 * @returns {!Promise<!string[]>} A promise that resolves with an array of the files
 *    that were added. This will not always be the same as the files passed in because
 *    `fossil add` skips any files that are already in the repository. If no files were
 *    added, the promise resolves with an empty array.
 * @see https://fossil-scm.org/home/help?cmd=add
 */
async function addCmd(files) {
  if (!Array.isArray(files)) {
    files = [files];
  } else if (files.length === 0) {
    return [];
  }
  // note: fossil add works correctly even if a file is an absolute path
  const lines = await fossilCmd(["add", ...files], { splitLines: true });
  const addedFiles = lines.filter((line) => line.startsWith("ADDED"));
  // output format is "ADDED  file" (there are 2 spaces) so slice off 7 characters
  return addedFiles.map((line) => line.slice(7));
}

/**
 * Commits a file to the repository using `fossil commit`.
 * @param {(string|!string[])} files - The files to commit. They can be absolute paths
 *    or paths relative to the speechviz/data directory. If a string is passed in, only
 *    it will be committed.
 * @param {Object} options - Options for the command.
 * @param {string} [options.message="Automatic commit by fossil.js"] - The commit
 *    message.
 * @param {string} [options.user="fossil.js"] - The user to commit as.
 * @param {string=} options.branch - The branch to commit to. If not specified, the
 *    current branch (which should be "trunk") will be used. If the branch doesn't
 *    exist, it will be created.
 * @param {(string[]|Object<string, ?string>)=} options.tags - The tags to add to the
 *    commit. If not specified, no tags will be added. If an array, each tag will be
 *    added with no value. If an object, each key will be added as a tag with the value
 *    being the value of the key (or no value if the value is `null`).
 * @param {string=} options.datetime - The date and time to use for the commit. If not
 *    specified, the current date and time will be used.
 * @returns {!Promise<string>} A promise that resolves to the commit hash.
 * @see https://fossil-scm.org/home/help?cmd=commit
 */
async function commitCmd(
  files,
  {
    message = "Automatic commit by fossil.js",
    user = "fossil.js",
    branch,
    tags,
    datetime,
  } = {}
) {
  if (!Array.isArray(files)) {
    files = [files];
  }
  // note: fossil commit works correctly even if file is an absolute path
  const args = ["commit", "-m", message, "--user-override", user, ...files];
  if (tags) {
    // tags without values can be passed as options
    if (Array.isArray(tags)) {
      tags.forEach((tag) => args.push("--tag", tag));
      // set tags to {} so later we don't need special handling for when it's an array
      tags = {};
    } else {
      // Filter out null values to pass as options to the command.
      // The rest will be added later using tag.add (--tag doesn't support values)
      const noValueTags = Object.entries(tags).filter(
        ([, value]) => value === null
      );
      noValueTags.forEach((tag) => {
        args.push("--tag", tag);
        delete tags[tag]; // remove tag now so we don't add it again later
      });
    }
  } else {
    tags = {};
  }
  // FIXME: this doesn't work if the ancestor commit is more recent than date
  //        It could be fixed using --allow-older but I'm not sure I want that
  // if (datetime) {
  //   args.push("--date-override", datetime);
  // }
  let output;
  // use a helper function so we can use withBranch if necessary
  const _commit = async () => {
    output = await fossilCmd(args, { removeNewline: true });
  };
  if (branch === undefined) {
    // specifically check for undefined in case branch is empty string for some reason
    await _commit(); // we don't need to switch branches
  } else {
    const branches = await branchCmd.list();
    if (branches.current === branch) {
      // if the branch is the current branch, we can just commit without switching
      await _commit();
    } else if (!branches.includes(branch)) {
      // If statement because --branch only works if the branch doesn't exist.
      // We still need to switch back to the original branch after committing, but it's
      // easier than creating the branch and then using withBranch (which might not
      // work anyways since `fossil branch new` leaves you on the new branch I think)
      const originalBranch = branches.current;
      args.push("--branch", branch);
      await _commit();
      // switch back to original branch after committing (commit stays on new branch)
      await updateCmd(originalBranch);
    } else {
      // use withBranch to switch to the branch, commit, and switch back
      await withBranch(branch, _commit);
    }
  }
  // fossil commit outputs "New_Version: ARTIFACT-ID" so use substring to get the id
  const commitId = output.substring(13);
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
   * @param {string} tagname - The name of the tag.
   * @param {string} checkinId - The ID of the checkin to tag.
   * @param {?string} value - The value of the tag. If `null`, the tag will be added
   *    with no value.
   * @param {Object} options - Options for the command.
   * @param {boolean} [options.raw=false] - If `true`, `fossil` doesn't prepend the tag
   *    name with "sym-" (which is used for user-defined tags), allowing manipulation
   *    of tags that `fossil` uses internally. This is not recommended.
   * @param {boolean} [options.propagate=false] - Whether the tag should propagate to
   *    descendants of the checkin.
   * @param {string=} options.datetime - The date and time to use for when the tag was
   *    added. If not specified, the current date and time will be used.
   * @param {string} [options.user="fossil.js"] - The user to add the tag as.
   * @returns {!Promise<void>} A promise that resolves when the command is finished.
   */
  async add(
    tagname,
    checkinId,
    value = null,
    { raw = false, propagate = false, user = "fossil.js" } = {}
  ) {
    const args = ["tag", "add", "--user-override", user, tagname, checkinId];
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
    // if (datetime) {
    //   args.push("--date-override", datetime);
    // }
    await fossilCmd(args);
  },

  /**
   * Runs `fossil tag cancel` to remove a tag from a checkin.
   *
   * `tag cancel` also removes the tag from descendants of the checkin if it was
   * propagated.
   * @param {string} tagname - The name of the tag to remove.
   * @param {string} checkinId - The ID of the checkin to remove the tag from.
   * @param {Object} options - Options for the command.
   * @param {boolean} [options.raw=false] - If `true`, `fossil` doesn't prepend the tag
   *   name with "sym-" (which is used for user-defined tags), allowing manipulation
   *  of tags that `fossil` uses internally. This is not recommended.
   * @param {string=} options.datetime - The date and time to use for when the tag was
   *    removed. If not specified, the current date and time will be used.
   * @param {string} [options.user="fossil.js"] - The user to remove the tag as.
   * @returns {!Promise<void>} A promise that resolves when the command is finished.
   */
  async cancel(tagname, checkinId, { raw = false, user = "fossil.js" } = {}) {
    const args = ["tag", "cancel", "--user-override", user, tagname, checkinId];
    if (raw) {
      args.push("--raw");
    }
    // FIXME: this doesn't work if the ancestor commit is more recent than datetime
    //        It could be fixed using --allow-older but I'm not sure I want that
    // if (datetime) {
    //   args.push("--date-override", datetime);
    // }
    await fossilCmd(args);
  },

  /**
   * Runs `fossil tag find` to find checkins using a tag.
   *
   * This function differs from the actual `fossil tag find` command in 2 ways:
   *
   * 1. It always returns an array of checkin IDs, unlike `tag find` which returns
   *    checkin IDs only if `raw` is `true`. When `raw` is `false`, `tag find` returns
   *    a list of checkins with their checkin IDs, timestamps, and comments.
   * 2. `type` can be used in conjunction with `raw`, whereas `tag find` ignores `type`
   *    if `raw` is `true`.
   *
   * @param {string} tagname - The name of the tag to search for.
   * @param {Object} options - Options for the command.
   * @param {boolean} [options.raw=false] - If `true`, 'sym-' will never be prepended
   *    to the tag name, allowing manipulation of tags that `fossil` uses internally
   *    (which is not recommended). If `false`, the tag name will be prepended with
   *    'sym-' only if `type` is "ci". This differs from other `tag` subcommands, which
   *    always prepend 'sym-' if `raw` is `false`.
   * @param {?("ci"|"w"|"e"|"f"|"t")} [options.type="ci"] - The type of objects whose
   *    tags should be searched. If `null`, all types will be searched. "ci" is
   *    checkins, "w" is wiki pages, "e" is events / technotes, "f" is forum posts,
   *    and "t" is tickets. Defaults to "ci".
   * @param {number=} options.limit - The maximum number of checkins to return. If
   *    unspecified, all checkins will be returned.
   * @returns {!Promise<(!string[])>} A promise that resolves to an array of artifact
   *    IDs of objects that have the tag. If no objects are found, the promise resolves
   *    to an empty array.
   */
  find(tagname, { raw = false, type = "ci", limit } = {}) {
    return sqlCmd("..queries/getTagged.sql", { tagname, raw, type, limit });
  },

  /**
   * Lists tags using `fossil tag list`.
   * @param {string=} checkinId - The ID of the checkin to list tags for. If
   *    unspecified, all tag names will be returned. Otherwise, the checkin's tags and
   *    values will be returned.
   * @param {Object} options - Options for the command.
   * @param {boolean} [options.raw=false] - If `true`, the raw names of tags are
   *    returned. Otherwise, internal prefixes like "sym-" are stripped from the tag
   *    names.
   * @param {("cancel"|"singleton"|"propagate")=} options.type - The type of tags
   *    to list. If not specified, all tags will be listed.
   * @param {boolean} [options.inverse=false] - If `true`, the meaning of `type` is
   *    inverted so that only tags that aren't of the given type are returned.
   * @param {string=} options.prefix - The prefix to filter tags by. The prefix is
   *    stripped from the tag names in the output unless `raw` is `true`.
   * @param {boolean} [options.parseNums=true] - Whether to parse numbers in tag values.
   *    Only applies if `checkinId` is given. Numbers are parsed using `parseFloat`.
   * @returns {!Promise<!(string[]|Object<string, ?string>)>} If `checkinId` isn't
   *    given, a promise that resolves to an array of tag names. Otherwise, a promise
   *    that resolves to an object mapping tag names to values. If no tags are found,
   *    the promise resolves to an empty array or object.
   */
  async list(
    checkinId,
    { raw = false, type, inverse = false, prefix, parseNums = true } = {}
  ) {
    const args = ["tag", "list"];
    if (checkinId) {
      args.push(checkinId);
    }
    if (raw) {
      args.push("--raw");
    }
    if (type) {
      args.push("--type", type);
    }
    if (inverse) {
      args.push("--inverse");
    }
    if (prefix) {
      args.push("--prefix", prefix);
    }
    const lines = await fossilCmd(args, { splitLines: true });
    if (checkinId) {
      return lines; // if uuid isn't given, only tag names are output
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
   * @returns {!Promise<string>} A promise that resolves to the name of the current
   *    branch.
   */
  current() {
    return fossilCmd(["branch", "current"], { removeNewline: true });
  },

  /**
   * Runs `fossil branch list` to get a list of branches.
   * @returns {!Promise<!string[]>} A promise that resolves to an array of branch names.
   *    The array has a `current` property that is the name of the current branch.
   */
  async list() {
    const lines = await fossilCmd(["branch", "list"], { splitLines: true });
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
   *
   * This differs from the `fossil stash save` command in that it can invert the
   * meaning of the `files` argument.
   * @param {(string|!string[])} [files=[]] - The files to stash. If `inverse` is
   *    `true`, all files except those in `files` will be stashed instead of stashing
   *    only those in `files`. If `files` is empty, all changes will be stashed,
   *    regardless of `inverse`'s value. The files can be absolute paths or paths
   *    relative to the speechviz/data directory. If a string is given, it will be
   *    converted to a single-element array.
   * @param {Object} options - Options for the command.
   * @param {boolean} [options.inverse=false] - If `true`, all files except those in
   *   `files` will be stashed instead of stashing only those in `files`.
   * @param {string} [options.message="Stashed by fossil.js"] - The message to use for
   *    the stash.
   * @returns {!Promise<number>} A promise that resolves to the stash ID.
   */
  async save(
    files = [],
    { inverse = false, message = "Stashed by fossil.js" } = {}
  ) {
    if (!Array.isArray(files)) {
      files = [files];
    }
    // note: fossil stash works correctly even if the files are absolute paths
    if (inverse) {
      const changed = await changesCmd();
      files = Object.keys(changed).filter((file) => !files.includes(file));
    }
    const args = ["stash", "save", "-m", `"${message}"`, ...files];
    const output = await fossilCmd(args);
    const [, stashId] = stashIdRegex.exec(output);
    return parseInt(stashId);
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
   * @param {number} stashId - The ID of the stash to apply.
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
 * @param {!withStashCallback} callback - The callback to run. It is passed the stash
 *    ID as an argument.
 * @param {(string|!string[])} [files=[]] - The file(s) to stash or ignore.
 * @param {!Object} [options={}] - Options for the stash save command.
 * @see stashCmd.save
 */
async function withStash(callback, files = [], options = {}) {
  const stashId = await stashCmd.save(files, options);
  await callback(stashId);
  await stashCmd.apply(stashId);
}

// TODO: right now this is limited functionality of `fossil update`
/**
 * Updates to the given version using `fossil update`.
 * @param {string} version - The version to update to. This can be a tag, branch, or
 *    checkin ID.
 * @param {Object} options - Options for the command.
 * @param {boolean} [options.setmtime=false] - If `true`, the mtime of all files will
 *    be updated to match the timestamp of the checkin that they were last changed in.
 * @see https://fossil-scm.org/home/help?cmd=update
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
 * @param {!withBranchCallback} callback - The callback to run. It is passed the
 *    original branch as an argument.
 * @see updateCmd
 */
async function withBranch(branch, callback) {
  const originalBranch = await branchCmd.current();
  await updateCmd(branch);
  await callback(originalBranch);
  await updateCmd(originalBranch);
}

/**
 * Returns the contents of a file at a given checkin using `fossil cat`.
 * @param {string} file - The file to get the contents of.
 * @param {Object} options - Options for the command.
 * @param {string=} options.checkin - The checkin to get the file contents from. If
 *    omitted, the file contents from the current checkin (which should be the latest
 *    checkin on the "trunk" branch) will be returned.
 * @see https://fossil-scm.org/home/help?cmd=cat
 */
function catCmd(file, { checkin } = {}) {
  const args = ["cat", file];
  if (checkin) {
    args.push("-r", checkin);
  }
  return fossilCmd(args);
}

/**
 * Returns the contents of an artifact using `fossil artifact`.
 * @param {string} id - The artifact ID of the file.
 * @returns {!Promise<string>} A promise that resolves to the file contents.
 * @see https://fossil-scm.org/home/help?cmd=artifact
 */
function artifactCmd(id) {
  return fossilCmd(["artifact", id]);
}

// use . instead of \S for the unlikely case that a file name contains spaces
const changesFileRegex = /(.+?)\s+(.+)/; // matches the change type and file name

/**
 * Parses the output of `fossil changes` into an `Object` mapping file names to change
 * types.
 * @param {!string[]} output - The output of `fossil changes`, split into lines.
 * @returns {!Object<string, string>} An `Object` mapping file names to change types.
 *   If a file has not been changed (i.e. it is not in the output), it will not be a key
 *   in the object.
 */
function parseChangesOutput(output) {
  const changes = {};
  for (const line of output) {
    const [, type, file] = changesFileRegex.exec(line);
    changes[file] = type;
  }
  return changes;
}

/**
 * Runs `fossil changes` to get a list of changed files.
 * @param {(string|string[])} [files=[]] - The files to check for changes. If empty,
 *    all files will be checked. They can be absolute paths or paths relative to the
 *    speechviz/data directory. If `files` is a string, only that file will be checked.
 * @returns {!Promise<!Object<string, string>>} A promise that resolves to an `Object`
 *   mapping file names to change types. If a file has not been changed, it will not be
 *   a key in the object.
 * @see https://fossil-scm.org/home/help?cmd=changes
 */
async function changesCmd(files = []) {
  if (!Array.isArray(files)) {
    files = [files];
  }
  // always pass classify since if a user doesn't want
  // changes types, they can just ignore them
  const args = ["changes", "--classify", ...files];
  const lines = await fossilCmd(args, { splitLines: true });
  if (lines.length === 0) {
    return {};
  }
  return parseChangesOutput(lines);
}

/**
 * Returns whether there are any changes in the repository.
 * @param {(string|string[])} [files=[]] - The files to check for changes. If empty,
 *    all files will be checked. They can be absolute paths or paths relative to the
 *    speechviz/data directory. If `files` is a string, only that file will be checked.
 * @returns {!Promise<boolean>} A promise that resolves to `true` if there are changes
 *    and `false` otherwise.
 */
// changes uses files instead of ...files (because it takes options after the files),
// so we use the same convention here
async function hasChanges(files = []) {
  const changes = await changesCmd(files);
  return Object.keys(changes).length > 0;
}

/**
 * Runs a `fossil` query to get the version history of a file.
 * @param {string} file - The file to get the version history for. It should be a path
 *    relative to the speechviz/data directory. If it is not, it will be converted to
 *    one.
 * @param {Object} options - Options for the command.
 * @param {?string} [options.branch=null] - The branch to get the version history for.
 *    If `null`, every branch will be included.
 * @param {number} [options.limit=-1] - The maximum number of versions to get. -1 is
 *    equivalent to no limit. Note that if `branch` is `null`, this limit will not be
 *    applied to each branch individually but to the total number of versions.
 * @param {("asc"|"desc")} [options.order="desc"] - The order to get the versions in.
 *   "asc" is oldest to newest, "desc" is newest to oldest.
 * @param {boolean} [options.parseNums=true] - Whether to parse numbers in tag values.
 *    Numbers are parsed using `parseFloat`.
 * @returns {!Promise<!VersionEntry[]>} A promise that resolves to an array of
 *    VersionEntry objects.
 */
async function versionsCmd(
  file,
  { branch = null, limit = -1, order = "desc", parseNums = true } = {}
) {
  // file has to be relative to the directory the repository is in since that's the
  // path stored in the database
  if (path.isAbsolute(file)) {
    file = path.relative(dataDir, file);
  }
  const params = { file, branch, limit, order };
  const lines = await sqlCmd(".read ../queries/getVersions.sql", params);
  return lines.map((line) => {
    const entry = JSON.parse(line);
    if (parseNums) {
      Object.entries(entry.tags).forEach(([key, value]) => {
        const num = parseFloat(value);
        if (!isNaN(num)) {
          entry.tags[key] = num;
        }
      });
    }
    return entry;
  });
}

/**
 * Gets the oldest version of a file.
 *
 * Note that this doesn't return the contents of the oldest version, just the
 * information about it.
 * @param {string} file - The file to get the oldest version of. It should be a path
 *    relative to the speechviz/data directory. If it is not, it will be converted to
 *    one.
 * @param {Object} options - Options for the command.
 * @param {?string} [options.branch=null] - The branch to get the oldest version of.
 *    If `null`, the oldest version from any branch will be returned.
 * @param {boolean} [options.parseNums=true] - Whether to parse numbers in tag values.
 *    Numbers are parsed using `parseFloat`.
 * @returns {!Promise<!VersionEntry>} A promise that resolves to the VersionEntry for
 *    the oldest version of the file.
 */
async function oldestVersion(file, { branch = null, parseNums = true } = {}) {
  return (
    await versionsCmd(file, { branch, limit: 1, order: "asc", parseNums })
  )[0];
}

/**
 * Gets the latest version of a file.
 *
 * Note that this doesn't return the contents of the latest version, just the
 * information about it.
 * @param {string} file - The file to get the latest version of. It should be a path
 *    relative to the speechviz/data directory. If it is not, it will be converted to
 *    one.
 * @param {Object} options - Options for the command.
 * @param {?string} [options.branch=null] - The branch to get the latest version of.
 *    If `null`, the latest version from any branch will be returned.
 * @param {boolean} [options.parseNums=true] - Whether to parse numbers in tag values.
 *    Numbers are parsed using `parseFloat`.
 * @returns {!Promise<!VersionEntry>} A promise that resolves to the VersionEntry for
 *    the latest version of the file.
 */
async function latestVersion(file, { branch = null, parseNums = true } = {}) {
  return (await versionsCmd(file, { branch, limit: 1, parseNums }))[0];
}

/**
 * Checks if a file has been added to the repository using `fossil add`.
 * @param {string} file - The file to check. It can be an absolute path or a path
 *    relative to the speechviz/data directory.
 * @returns {!Promise<boolean>}
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
  oldestVersion,
  latestVersion,
  isInRepo,
};
