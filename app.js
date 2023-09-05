const express = require("express");
const path = require("path");
const fs = require("fs");
const logger = require("morgan");
const cookieParser = require("cookie-parser");

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
const fossilUtil = require("./server/fossilUtil");
const propagate = require("./server/propagate");
const { readdirAndFilter } = require("./server/io");

const dataDir = path.join(__dirname, "data");

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
  if (reqUrl.startsWith("/login") || req?.session?.authenticated) {
    // If the user is authenticated, then we can continue to the next handler
    // Otherwise if the user is trying to login, we need to let them through
    next();
  } else {
    // not authenticated so redirect to login page
    let loginUrl = "/login";
    // only add the requested url as a parameter if it isn't "/"
    // because "/" is the default when no referer is given
    if (reqUrl !== "/") {
      // reqUrl needs to be encoded so that characters like "&" don't break the url
      // encodeURI doesn't encode "&" so we need to use encodeURIComponent
      loginUrl += `?referer=${encodeURIComponent(reqUrl)}`;
    }
    res.redirect(loginUrl);
  }
}
app.use(logger("dev"));
app.use(express.json({ limit: "50mb" }));
app.use(express.json());
// urlencoded is needed for the login form
app.use(express.urlencoded({ extended: false }));
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

app.get("/clustered-files", async (req, res) => {
  const faceClusters = await readdirAndFilter("data/faceClusters/");
  if (faceClusters.includes(req.session.dir)) {
    const files = {};
    const commonDir = "data/faceClusters/" + req.session.dir + "/";
    files.cluster = await readdirAndFilter(commonDir);
    files.inFaceFolder = req.session.inFaceFolder;
    files.dir = req.session.dir;
    if (req.session.inFaceFolder == true) {
      const faceFolder = req.session.faceFolder;
      files.faceFolder = faceFolder;
    } else {
      // serve an image from each cluster to viz for display
      const imageFiles = {};
      for (const folder of files.cluster) {
        const images = await readdirAndFilter(commonDir + folder);
        let noImageYet = true;
        while (noImageYet) {
          // grab first image in cluster and send to viz
          const fileName = images[0];
          if (path.extname(fileName) === ".jpg") {
            noImageYet = false;
            imageFiles[folder] = fileName;
          }
        }
      }

      files.images = imageFiles;
      files.dir = req.session.dir;
    }
    res.send(files);
    return;
  }
  res.status(404).send("Not Found");
});

app.get("/user", (req, res) => {
  res.send(req.session.user);
});

// GET /versions/:file(*)?limit=n&branch=branchName
// Returns the version history of the specified file, optionally limited to the
// specified number of versions and/or the specified branch.
// (*) allows any characters, including slashes, in the file parameter
// this is necessary for when the file is in a subdirectory of the annotations folder
// if we ever upgrade to express 5.x, "(*)" will be incorrect and need to be replaced
// with "(.*)": https://github.com/expressjs/express/issues/2495
app.get("/versions/:file(*)", async (req, res) => {
  const { limit = -1, branch = null } = req.query; // limit -1 means no limit
  // req.params.file is the matched value of :file(*)
  const file = path.join(dataDir, "annotations", req.params.file);
  try {
    // ensure the latest version of the file is in the repo
    await fossilUtil.addAndCommit(file);
    const versionEntries = await fossil.versions(file, { limit, branch });
    res.json(versionEntries);
  } catch (err) {
    res.status(500).send(err.toString());
  }
});

// GET /annotations/:file(*)?commit=commitHash&branch=branchName
// Returns the contents of the specified file, optionally from the specified commit
// or branch.
app.get("/annotations/:file(*)", async (req, res) => {
  const file = path.join(dataDir, "annotations", req.params.file);
  try {
    const { commit, branch } = req.query;
    const annotations = await fossilUtil.catAnnotations(file, {
      commit,
      branch,
    });
    // can't use res.json because annotations is a string
    res.type("json").send(annotations);
  } catch (err) {
    res.status(500).send(err.toString());
  }
});

// GET /branch/list
// Returns the list of branches in the fossil repository.
app.get("/branch/list", async (req, res) => {
  try {
    res.json(await fossil.branch.list());
  } catch (err) {
    res.status(500).send(err.toString());
  }
});

// POST /annotations/:file(*)
// Saves the annotations to the specified file. The annotations (and optionally the
// branch and commit message) are in the request body as JSON.
app.post("/annotations/:file(*)", async (req, res) => {
  const user = req.session.user;
  const file = path.join(dataDir, "annotations", req.params.file);
  const { annotations, branch, message } = req.body;
  try {
    // I used "  " for the indent because I think fossil uses line-based diffs and
    // using "  " makes the json use multiple lines
    const json = JSON.stringify(annotations, null, "  ");
    await fossil.writeAndCommit(file, json, { user, branch, message });
    // unless the server has commit something else after the commit above,
    // the latest version will be the one we just committed
    // (we should handle this better in the future, but the same issue exists
    // elsewhere in the code so for now it's fine)
    const version = await fossil.latestVersion(file, { branch });
    res.json(version);
  } catch (err) {
    res.status(500).send(err.toString());
  }
});

// POST /propagate/:file(*)
// Propagates the new TreeItems in the annotations to the files the view was
// created from and saves the new annotations to the file.
app.post("/propagate/:file(*)", async (req, res) => {
  const user = req.session.user;
  const file = req.params.file;
  const { annotations, branch, message } = req.body;
  try {
    await propagate(file, annotations, { user, branch, message });
    res.status(200).end();
  } catch (err) {
    res.status(500).send(err.toString());
  }
});

// can't use await readdirAndFilter because this isn't in an async function
const dataSubdirs = fs.readdirSync("data").filter((file) => {
  return file !== "annotations";
});
// matches any request that start with "/subdir" where subdir is
// a subdirectory of the data directory
// escape is there because regex interprets string as is and doesn't escape for you
// eslint-disable-next-line no-useless-escape
const dataSubdirRegex = new RegExp(`\/(${dataSubdirs.join("|")})`);
app.get(dataSubdirRegex, async (req, res) => {
  const url = "data" + req.url;
  try {
    const stat = await fs.promises.stat(url);
    // if it's a directory, return list of file names in that directory
    if (stat.isDirectory()) {
      return res.send(await readdirAndFilter(url));
    }
    // if it's a file, return the file
    else {
      return res.sendFile(url, { root: __dirname });
    }
  } catch (err) {
    // catch error from stat when file doesn't exist
    return res.status(404).send("Not Found");
  }
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

app.post("/isSplitChannel", async (req, res) => {
  const folder = req.body.folder;
  const basename = req.body.basename;
  let waveforms;
  if (folder) {
    waveforms = await readdirAndFilter(`data/waveforms/${folder}`);
  } else {
    waveforms = await readdirAndFilter("data/waveforms");
  }
  // if it has a -mono waveform it must be a split-channel file
  res.send(waveforms.indexOf(`${basename}-waveform-mono.json`) !== -1);
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
