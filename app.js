var express = require('express');
var path = require('path');
var fs = require("fs");
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');

var index = require('./routes/index-route');
var clusteredFaces = require('./routes/face-cluster-route')
var viz = require('./routes/viz-route');
var login = require('./routes/login-route');
var changePassword = require('./routes/change-password-route');
var settings = require('./routes/settings-route');
var app = express();

var Database = require('better-sqlite3');
var db = new Database("speechviz.sqlite3");

// use sessions
var session = require('express-session');
app.use(session({
  secret: 'clinic annotations here',
  resave: false,
  saveUninitialized: true,
}));

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

/**
 The checkAuthentification method will be executed on all incoming requests (excluding pages starting with /login)
 It is based on the example from https://gist.github.com/smebberson/1581536
 Essentially, you will have to obtain an authorization per session.
 */
function checkAuthentification(req, res, next) {
  let reqUrl = req.originalUrl;
  if (reqUrl.startsWith('/login')) { next(); }
  else {
    if (!req.session || !req.session.authenticated) {
      res.redirect(`/login?referer=${reqUrl}`);  // will redirect to requested url after successful login
    }
    else { next(); }  // authenticated
  }
}

app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(checkAuthentification)

app.use('/', index);
app.use('/clustered-faces', clusteredFaces);
app.use('/viz', viz);
app.use('/login', login);
app.use("/change-password", changePassword);
app.use("/settings", settings);

app.get('/logout', (req, res) => {
  req.session.authenticated = false;
  delete req.session.user;
  res.redirect('/login');
  return;
});

app.get("/clustered-files", (req, res) => {
  const exclude = new Set([".DS_Store"]);  // I just used a Set because Set.has() is faster than Array.includes()
  console.log(req.session);
  const files = {};
  files.cluster = fs.readdirSync("data/faceClusters/" + req.session.dir).filter(fileName => !exclude.has(fileName));
  if (req.session.inFaceFolder == true) {
    faceFolder = req.session.faceFolder
    files.faceFolder = faceFolder;
  }
  //else{//serve an image from each
    //const imageFiles = {};
    //files.cluster.forEach(function (folder) {
      //images = fs.readdirSync("data/faceClusters/" + req.session.dir + "/" + folder).filter(fileName => !exclude.has(fileName));
      //noImageYet = true;
      //counter = 0;
      //while(noImageYet){
        //path = images[counter];
        //if(path.extname(fileName) === ".jpg")
          //noImageYet = false; 
          //imageFiles.folder = path;
        //}
      //});
    //files.images = imageFiles;
    console.log("images sent to speechviz");
    //console.log(files.images);
  }
  
  res.send(files);
});

app.get("/filelist", (req, res) => {
  const exclude = new Set([".DS_Store"]);  // I just used a Set because Set.has() is faster than Array.includes()
  const files = {};
  files.audio = fs.readdirSync("data/audio").filter(fileName => !exclude.has(fileName));
  files.video = fs.readdirSync("data/video").filter(fileName => !exclude.has(fileName));
  files.cluster = fs.readdirSync("data/faceClusters").filter(fileName => !exclude.has(fileName));
  res.send(files);
});

app.get("/user", (req, res) => { res.send(req.session.user); });
app.get("/users", (req, res) => {
  if (req.session.user == "admin") {
    res.send(db.prepare("SELECT user FROM users").all().map(user => user.user));
  }
  else {
    res.send([req.session.user]);
  }
});

app.get(/\/(audio|segments|video|waveforms|transcriptions)/, (req, res) => res.sendFile(req.url, {root: __dirname + "/data"}));

//#region saving, loading, and resetting
const selectFileId = db.prepare("SELECT id FROM audiofiles WHERE audiofile=?");
const insertFile = db.prepare("INSERT INTO audiofiles(audiofile) VALUES(?)");

const selectUserId = db.prepare("SELECT id FROM users WHERE user=?");

const deleteSegments = db.prepare('DELETE FROM annotations WHERE fileId=? AND userId=?');
const deleteNotes = db.prepare("DELETE FROM notes WHERE fileId=? AND userId=?");

const selectLabelId = db.prepare("SELECT id FROM labels WHERE label=?");
const insertLabel = db.prepare("INSERT INTO labels(label) VALUES(?)");

const selectPathId = db.prepare("SELECT id FROM paths WHERE path=?");
const insertPath = db.prepare("INSERT INTO paths(path) VALUES(?)");

const insertSegment = db.prepare("INSERT INTO annotations(fileId,userId,startTime,endTime,editable,labelId,id,pathId,treeText,removable) VALUES(?,?,?,?,?,?,?,?,?,?)");
const insertNotes = db.prepare("INSERT INTO notes(fileId,userId,notes) VALUES(?,?,?)");

const save = db.transaction((filename, user, segments, notes) => {
  let fileId = selectFileId.get([filename])?.id;
  if (!fileId) {
    fileId = insertFile.run([filename]).lastInsertRowid;
  }
  const userId = selectUserId.get([user]).id;

  deleteSegments.run([fileId, userId]);
  deleteNotes.run([fileId, userId]);

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

    insertSegment.run([fileId, userId, segment.startTime, segment.endTime, segment.editable, labelId, segment.id, pathId, segment.treeText, segment.removable]);
  }

  insertNotes.run([fileId, userId, notes]);
});
app.use("/save/", (req, res) => {
  save(req.body["filename"], req.body["user"], req.body["segments"], req.body["notes"]);
  res.end();
});

const selectSegments = db.prepare("SELECT startTime,endTime,editable,labelId,id,pathId,treeText,removable FROM annotations WHERE fileId=? AND userId=?");

const selectLabel = db.prepare("SELECT label FROM labels WHERE id=?");
const selectPath = db.prepare("SELECT path FROM paths WHERE id=?");

const selectNotes = db.prepare("SELECT notes FROM notes WHERE fileId=? AND userId=?");

const load = db.transaction((filename, user) => {
  let fileId = selectFileId.get([filename])?.id;
  if (!fileId) {
    fileId = insertFile.run([filename]).lastInsertRowid;
  }
  const userId = selectUserId.get([user]).id;

  const loaded = {};

  const segments = selectSegments.all([fileId, userId]);
  for (const segment of segments) {
    segment.editable = !!segment.editable;  // "double not" to cast to boolean

    segment.labelText = selectLabel.get([segment.labelId]).label;
    delete segment.labelId;

    segment.path = selectPath.get([segment.pathId]).path.split("|");
    delete segment.pathId;
  }
  loaded.segments = segments;

  loaded.notes = selectNotes.get([fileId, userId])?.notes;

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
app.use("/reset-moved/", (req, res) => {
  resetMoved(req.body["filename"], req.body["user"], req.body["highestId"])
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
});
app.use("/reset/", (req, res) => {
  reset(req.body["filename"], req.body["user"])
  res.end();
});
//#endregion

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = err;

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
