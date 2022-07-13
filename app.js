var express = require('express');
var path = require('path');
var fs = require("fs");
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');

var index = require('./routes/index-route');
var viz = require('./routes/viz-route');
var login = require('./routes/login-route');
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
  let req_url = req.url.toString();
  if (req_url.startsWith('/login')) { next(); }
  else {
    if (!req.session || !req.session.authenticated) { 
      res.redirect('/login'); 
      return;
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
app.use('/viz', viz);
app.use('/login', login);

app.get("/filelist", (req, res) => {
  res.send(fs.readdirSync("data/audio").filter(fileName => fileName != ".DS_Store"));
});

app.get(/\/(audio|segments|waveforms)/, (req, res) => res.sendFile(req.url, {root: __dirname + "/data"}));

const selectFileId = db.prepare("SELECT id FROM audiofiles WHERE audiofile=?");
const insertFile = db.prepare("INSERT INTO audiofiles(audiofile) VALUES(?)");

const selectUserId = db.prepare("SELECT id FROM users WHERE user=?");

const deleteSegments = db.prepare('DELETE FROM annotations WHERE fileId=? AND userId=?');

const selectLabelId = db.prepare("SELECT id FROM labels WHERE label=?");
const insertLabel = db.prepare("INSERT INTO labels(label) VALUES(?)");

const selectPathId = db.prepare("SELECT id FROM paths WHERE path=?");
const insertPath = db.prepare("INSERT INTO paths(path) VALUES(?)");

const insertSegment = db.prepare("INSERT INTO annotations(fileId,userId,startTime,endTime,editable,labelId,id,pathId,treeText,removable) VALUES(?,?,?,?,?,?,?,?,?,?)");

const save = db.transaction((filename, user, segments) => {
  let fileId = selectFileId.get([filename])?.id;
  if (!fileId) {
    fileId = insertFile.run([filename]).lastInsertRowid;
  }
  console.log(segments);

  const userId = selectUserId.get([user]).id;

  deleteSegments.run([fileId, userId]);

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
});
app.use("/save/", (req, res) => {
  save(req.body["filename"], req.body["user"], req.body["segments"]);
  res.end();
});

const selectSegments = db.prepare("SELECT startTime,endTime,editable,labelId,id,pathId,treeText,removable FROM annotations WHERE fileId=? AND userId=?");

const selectLabel = db.prepare("SELECT label FROM labels WHERE id=?");
const selectPath = db.prepare("SELECT path FROM paths WHERE id=?");

const load = db.transaction((filename, user) => {
  let fileId = selectFileId.get([filename])?.id;
  if (!fileId) {
    fileId = insertFile.run([filename]).lastInsertRowid;
  }
  const userId = selectUserId.get([user]).id;

  const segments = selectSegments.all([fileId, userId]);
  for (const segment of segments) {
    segment.editable = !!segment.editable;  // "double not" to cast to boolean

    segment.labelText = selectLabel.get([segment.labelId]).label;
    delete segment.labelId;

    segment.path = selectPath.get([segment.pathId]).path.split("|");
    delete segment.pathId;
  }

  return segments;
});

app.use("/load/", (req, res) => {
  res.send(load(req.body["filename"], req.body["user"]));
  res.end();
});

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = err;

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
