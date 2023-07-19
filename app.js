const express = require("express");
const path = require("path");
const fs = require("fs");
const logger = require("morgan");
const cookieParser = require("cookie-parser");
const bodyParser = require("body-parser");

const index = require("./routes/index-route");
const clusteredFaces = require("./routes/face-cluster-route");
const viz = require("./routes/viz-route");
const login = require("./routes/login-route");
const changePassword = require("./routes/change-password-route");
const settings = require("./routes/settings-route");
const app = express();

const Database = require("better-sqlite3");
const db = new Database("speechviz.sqlite3");

const fossil = require("./server/fossil");

// use sessions
const session = require("express-session");
app.use(
  session({
    name: "speechviz",
    secret: "clinic annotations here",
    resave: false,
    saveUninitialized: true,
  })
);

// view engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "pug");

/**
 * The checkAuthentification method will be executed on all incoming requests
 * (excluding pages starting with /login).
 * It is based on the example from https://gist.github.com/smebberson/1581536
 * Essentially, you will have to obtain an authorization per session.
 */
function checkAuthentification(req, res, next) {
  const reqUrl = req.originalUrl;
  if (reqUrl.startsWith("/login")) {
    next();
  } else {
    if (!req.session || !req.session.authenticated) {
      // will redirect to requested url after successful login
      res.redirect(`/login?referer=${reqUrl}`);
    } else {
      next();
    } // authenticated
  }
}

app.use(logger("dev"));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));
app.use(checkAuthentification);

app.use("/", index);
app.use("/clustered-faces", clusteredFaces);
app.use("/viz", viz);
app.use("/login", login);
app.use("/change-password", changePassword);
app.use("/settings", settings);

app.get("/logout", (req, res) => {
  req.session.authenticated = false;
  delete req.session.user;
  res.redirect("/login");
  return;
});

// A set of files to exclude file lists.
// ".DS_STORE" is a hidden file on mac in all folders
// ".fslckout" is a hidden file in fossil repos
const excludedFiles = new Set([".DS_Store", ".fslckout"]);
const readdirAndFilter = (path) =>
  fs.readdirSync(path).filter((file) => !excludedFiles.has(file));

app.get("/clustered-files", (req, res) => {
  if (fs.readdirSync("data/faceClusters/").includes(req.session.dir)) {
    const files = {};
    const commonDir = "data/faceClusters/" + req.session.dir + "/";
    files.cluster = readdirAndFilter(commonDir);
    files.inFaceFolder = req.session.inFaceFolder;
    files.dir = req.session.dir;
    if (req.session.inFaceFolder == true) {
      const faceFolder = req.session.faceFolder;
      files.faceFolder = faceFolder;
    } else {
      // serve an image from each cluster to viz for display
      const imageFiles = {};
      files.cluster.forEach(function (folder) {
        const images = readdirAndFilter(commonDir + folder);
        let noImageYet = true;
        while (noImageYet) {
          // grab first image in cluster and send to viz
          const fileName = images[0];
          if (path.extname(fileName) === ".jpg") {
            noImageYet = false;
            imageFiles[folder] = fileName;
          }
        }
      });

      files.images = imageFiles;
      files.dir = req.session.dir;
    }
    res.send(files);
    return;
  }
  res.status(404).send("Not Found");
});

app.get("/filelist", (req, res) => {
  const files = {};
  files.audio = readdirAndFilter("data/audio");
  files.video = readdirAndFilter("data/video");
  files.cluster = readdirAndFilter("data/faceClusters");
  res.send(files);
});

app.get("/user", (req, res) => {
  res.send(req.session.user);
});
app.get("/users", (req, res) => {
  if (req.session.user == "admin") {
    res.send(
      db
        .prepare("SELECT user FROM users")
        .all()
        .map((user) => user.user)
    );
  } else {
    res.send([req.session.user]);
  }
});

/**
 * Adds a file to the repository if not added and / or commits it if it has changes.
 * Used for adding and committing files that have been (re)processed externally.
 * @param {string} file - The file to add or commit (if necessary).
 * @returns {Promise<?string>} - The commit hash if a commit was made, null otherwise.
 */
const addAndCommit = async (file) => {
  const inRepo = await fossil.isInRepo(file);
  // !inRepo because file will need to be commit after adding
  const needsCommit = !inRepo || (await fossil.hasChanges(file));
  if (!inRepo) {
    await fossil.add(file);
  }
  if (needsCommit) {
    // get the datetime for when the file was updated
    const mtimeMs = (await fs.promises.stat(file)).mtimeMs;
    const date = new Date(mtimeMs).toISOString();

    let message = `Reprocess ${path.basename(file)}`;
    if (!inRepo) {
      message = `Process ${path.basename(file)}`;
    }

    return await fossil.commit(file, {
      message,
      branch: "trunk",
      // version: await fossil.getNextVersionNum(file, "trunk"),
      date,
    });
  }
  return null;
};

// (*) allows any characters, including slashes, in the file parameter
// this is necessary for when the file is in a subdirectory of the annotations folder
app.get("/versions/:file(*)", async (req, res) => {
  // const { version = null, branch = null } = req.body;
  const { limit = -1, branch = null } = req.body;
  const file = path.join(__dirname, "data", "annotations", req.params.file);
  try {
    await addAndCommit(file); // ensure the latest version of the file is in the repo
    // const versionEntries = await fossil.versions(file, { version, branch });
    const versionEntries = await fossil.versions(file, { limit, branch });
    res.json(versionEntries);
  } catch (err) {
    res.status(500).send(err.toString());
  }
});

app.get("/annotations/:file(*)", async (req, res) => {
  const file = path.join(__dirname, "data", "annotations", req.params.file);
  try {
    // if the client has a commit hash (from a version entry), use that
    let commit = req.query.commit;
    if (commit === undefined) {
      // otherwise, get the commit from the file and version
      await addAndCommit(file); // ensure the latest version of the file is in the repo
      // branch is null so that we get the latest version from any branch
      const { limit = 1, branch = null } = req.query;
      // fossil.versions returns an array of version entries so get the first
      const latestVer = (await fossil.versions(file, { limit, branch }))[0];
      commit = latestVer.commit;
    }
    // get the annotations for the version
    const annotations = await fossil.cat(file, { checkin: commit });
    // can't use res.json because annotations is a string
    res.type("json").send(annotations);
  } catch (err) {
    res.status(500).send(err.toString());
  }
});

app.get("/branch/list", async (req, res) => {
  try {
    res.json(await fossil.branchList());
  } catch (err) {
    res.status(500).send(err.toString());
  }
});

/**
 * Commits annotations to the repository.
 * @param {string} file - The file to commit annotations to.
 * @param {string} branch - The branch to commit to.
 * @param {object} annotations - The annotations to commit.
 * @param {object} [options] - Options for the commit.
 * @param {string} [options.user] - The user to commit as.
 * @param {string} [options.message] - The commit message.
 * @returns {Promise<fossil.VersionEntry>} - The version entry for the commit.
 */
const saveAnnotations = async (
  file,
  branch,
  annotations,
  { user, message } = {}
) => {
  // const version = await fossil.getNextVersionNum(file, branch);
  const json = JSON.stringify(annotations, null, "\t");
  return new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(file);
    writeStream.on("error", reject);
    // when the stream is finished writing, commit the file
    writeStream.on("finish", async () => {
      try {
        await fossil.commit(file, {
          message: message || `Updated annotations for ${file}`,
          branch,
          // version,
          user,
        });
        // resolve with the version entry for the commit
        // resolve((await fossil.versions(file, { branch, version }))[0]);
        // FIXME: this won't (?) necessarily return the version entry for the commit
        resolve((await fossil.versions(file, { branch }))[0]);
      } catch (err) {
        reject(err);
      }
    });
    writeStream.write(json);
    writeStream.end();
  });
};

app.post("/annotations", async (req, res) => {
  const user = req.session.user;
  const file = path.join(__dirname, "data", "annotations", req.body.file);
  const { annotations, branch = "trunk" } = req.body;
  try {
    const version = await saveAnnotations(file, annotations, user, branch);
    res.json(version);
  } catch (err) {
    res.status(500).send(err.toString());
  }
});

const dataSubdirs = readdirAndFilter("data").filter((file) => {
  return file !== "annotations";
});
// matches any request that start with "/subdir" where subdir is
// a subdirectory of the data directory
// escape is there because regex interprets string as is and doesn't escape for you
// eslint-disable-next-line no-useless-escape
const dataSubdirRegex = new RegExp(`\/(${dataSubdirs.join("|")})`);
app.get(dataSubdirRegex, (req, res) => {
  const url = "data" + req.url;
  fs.promises
    .stat(url)
    .then((stat) => {
      // if it's a directory, return list of file names in that directory
      if (stat.isDirectory()) {
        return res.send(readdirAndFilter(url));
      }
      // if it's a file, return the file
      else {
        return res.sendFile(url, { root: __dirname });
      }
    })
    // catch error from stat when file doesn't exist
    .catch(() => res.status(404).send("Not Found"));
});

const selectFileId = db.prepare("SELECT id FROM audiofiles WHERE audiofile=?");
const insertFile = db.prepare("INSERT INTO audiofiles(audiofile) VALUES(?)");

const selectUserId = db.prepare("SELECT id FROM users WHERE user=?");

const deleteSegments = db.prepare(
  "DELETE FROM annotations WHERE fileId=? AND userId=?"
);
const deleteNotes = db.prepare("DELETE FROM notes WHERE fileId=? AND userId=?");
const deleteFaces = db.prepare("DELETE FROM faces WHERE fileId=? AND userId=?");

const selectLabelId = db.prepare("SELECT id FROM labels WHERE label=?");
const insertLabel = db.prepare("INSERT INTO labels(label) VALUES(?)");

const selectPathId = db.prepare("SELECT id FROM paths WHERE path=?");
const insertPath = db.prepare("INSERT INTO paths(path) VALUES(?)");

const insertSegment = db.prepare(
  "INSERT INTO " + // eslint-disable-next-line max-len
    "annotations(fileId,userId,startTime,endTime,editable,labelId,id,pathId,treeText,removable) " +
    "VALUES(?,?,?,?,?,?,?,?,?,?)"
);
const insertNotes = db.prepare(
  "INSERT INTO notes(fileId,userId,notes) VALUES(?,?,?)"
);
const insertFace = db.prepare(
  "INSERT INTO faces(fileId,userId,speaker,faceNum) VALUES(?,?,?,?)"
);

const save = db.transaction((filename, user, segments, notes, faces) => {
  let fileId = selectFileId.get([filename])?.id;
  if (!fileId) {
    fileId = insertFile.run([filename]).lastInsertRowid;
  }
  const userId = selectUserId.get([user]).id;

  deleteSegments.run([fileId, userId]);
  deleteNotes.run([fileId, userId]);
  deleteFaces.run([fileId, userId]);

  for (const segment of segments) {
    const label = segment.labelText;
    let labelId = selectLabelId.get([label])?.id;
    if (!labelId) {
      labelId = insertLabel.run([label]).lastInsertRowid;
    }

    const path = segment.path.join("|");
    let pathId = selectPathId.get([path])?.id;
    if (!pathId) {
      pathId = insertPath.run([path]).lastInsertRowid;
    }

    segment.editable = +segment.editable;
    segment.removable = +segment.removable;

    insertSegment.run([
      fileId,
      userId,
      segment.startTime,
      segment.endTime,
      segment.editable,
      labelId,
      segment.id,
      pathId,
      segment.treeText,
      segment.removable,
    ]);
  }

  insertNotes.run([fileId, userId, notes]);
  for (let i = 0; i < faces.length; i = i + 2) {
    insertFace.run([fileId, userId, faces[i], faces[i + 1]]);
  }
});
app.use("/save/", (req, res) => {
  save(
    req.body["filename"],
    req.body["user"],
    req.body["segments"],
    req.body["notes"],
    req.body["faces"]
  );
  res.end();
});

const selectSegments = db.prepare(
  "SELECT " +
    "startTime,endTime,editable,labelId,id,pathId,treeText,removable " +
    "FROM annotations WHERE fileId=? AND userId=?"
);

const selectLabel = db.prepare("SELECT label FROM labels WHERE id=?");
const selectPath = db.prepare("SELECT path FROM paths WHERE id=?");

const selectNotes = db.prepare(
  "SELECT notes FROM notes WHERE fileId=? AND userId=?"
);

const selectFaces = db.prepare(
  "SELECT speaker,faceNum FROM faces WHERE fileId=? AND userId=?"
);

const load = db.transaction((filename, user) => {
  let fileId = selectFileId.get([filename])?.id;
  if (!fileId) {
    fileId = insertFile.run([filename]).lastInsertRowid;
  }
  const userId = selectUserId.get([user]).id;

  const loaded = {};

  const segments = selectSegments.all([fileId, userId]);
  for (const segment of segments) {
    segment.editable = !!segment.editable; // "double not" to cast to boolean

    segment.labelText = selectLabel.get([segment.labelId]).label;
    delete segment.labelId;

    segment.path = selectPath.get([segment.pathId]).path.split("|");
    delete segment.pathId;
  }
  loaded.segments = segments;

  loaded.notes = selectNotes.get([fileId, userId])?.notes;

  loaded.faces = selectFaces.all([fileId, userId]);

  return loaded;
});
app.use("/load/", (req, res) => {
  res.send(load(req.body["filename"], req.body["user"]));
  res.end();
});

const deleteSegment = db.prepare("DELETE FROM annotations WHERE id=?");

const resetMoved = db.transaction((filename, user, highestId) => {
  let fileId = selectFileId.get([filename])?.id;
  if (!fileId) {
    fileId = insertFile.run([filename]).lastInsertRowid;
  }
  const userId = selectUserId.get([user]).id;

  const segments = selectSegments.all([fileId, userId]);
  for (const segment of segments) {
    if (parseInt(segment.id.split(".").at(-1)) <= highestId) {
      deleteSegment.run([segment.id]);
    }
  }
});

app.use(express.json()); // <==== parse request body as JSON
app.post("/isSplitChannel", (req, res) => {
  const folder = req.body.folder;
  const basename = req.body.basename;
  let waveforms;
  if (folder !== null && folder !== null)
    waveforms = readdirAndFilter(`data/waveforms/${folder}`);
  else waveforms = readdirAndFilter("data/waveforms");
  // if it has a -mono waveform it must be a split-channel file
  if (waveforms.indexOf(`${basename}-waveform-mono.json`) !== -1)
    res.send(true);
  else res.send(false);
});

app.use("/reset-moved/", (req, res) => {
  resetMoved(req.body["filename"], req.body["user"], req.body["highestId"]);
  res.end();
});

const reset = db.transaction((filename, user) => {
  let fileId = selectFileId.get([filename])?.id;
  if (!fileId) {
    fileId = insertFile.run([filename]).lastInsertRowid;
  }
  const userId = selectUserId.get([user]).id;

  deleteSegments.run([fileId, userId]);
  deleteNotes.run([fileId, userId]);
  deleteFaces.run([fileId, userId]);
});
app.use("/reset/", (req, res) => {
  reset(req.body["filename"], req.body["user"]);
  res.end();
});

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  const err = new Error("Not Found");
  err.status = 404;
  next(err);
});

// error handler
app.use(function (err, req, res) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = err;

  // render the error page
  res.status(err.status || 500);
  res.render("error");
});

module.exports = app;
