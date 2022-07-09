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

function saveSegsOrPoints(userid, fileid, segments) {
  console.log('num items', segments.length);
  deleteStatement = db.prepare('DELETE FROM annotations WHERE user_id=? AND audiofile=?');
  deleteStatement.run([userid,fileid]);
  for (index=0; index < segments.length; index++) {
      let id = segments[index].id;
      let startTime = segments[index].startTime;
      let label = segments[index].labelText;
      var endTime;
      if (startTime == null) {
          console.log('\tthis is a point')
          startTime = segments[index].time;
          endTime = -1;
      } else {
          console.log('\tthis is a segment')
          endTime = segments[index].endTime;
      }
      console.log(`fileid=${fileid} userid=${userid} id=${id} start=${startTime} end=${endTime} label=${label}`)


      checkStmt = db.prepare('SELECT id FROM annotations WHERE id=?')
      //checkStmt = db.prepare('SELECT id FROM annotations WHERE user_id=? AND file_id=? AND id=?')
      checkAnnotation = checkStmt.get([id])
      if ((id < 0) || (!checkAnnotation))  {
        console.log('\tinserting');
        // statement = db.prepare('INSERT INTO annotations(id,user_id,file_id,start,end,label) VALUES(?,?,?,?,?,?)')
        // info = statement.run([id, userid, fileid, startTime, endTime, label])

        statement = db.prepare('INSERT INTO annotations(user_id,audiofile,start,end,label) VALUES(?,?,?,?,?)');
        info = statement.run([userid, fileid, startTime, endTime, label]);
        console.log('\tcommit', info);
      } else {
        console.log('\tupdating', fileid, 'start', startTime, 'end', endTime, 'label', label)
        //statement = db.prepare('UPDATE annotations SET start=?, end=?, label=? where file_id=? and user_id=? and id=?')
        statement = db.prepare('UPDATE annotations SET start=?, end=?, label=? WHERE id=?')
        info = statement.run([startTime, endTime, label, id])
        console.log('\tcommit', info)
      }
  }
}

app.use('/loadannotations/', function(req, res){
  /**
    Loads the annotations from the database for a given user and file
    When the annotate.html loads, it will make request to load all the annotatiosn for the current file
  **/
    console.log('---- load annotations ----')
    //console.log(req.body)
    let filename = req.body['filename']
    let user = req.body['user']
    console.log('user', user, 'audiofile', audiofile)
  
    // obtain the id of the user based on its user  
    var userid = db.prepare('SELECT id FROM users WHERE user=?').get(user).id
    console.log('user', user, '==>', userid)
  
    r = db.prepare('SELECT id,audiofile,start,end,label FROM annotations where user_id=? AND audiofile=?').all([userid, filename])

    console.log('retrieved', r.length, 'annotations')
    console.log(r)
  
    res.send(r)
    console.log(`---- load annotations ---- (end) total=${r.length}`)
    res.end()
});

app.use('/saveannotations/', function(req, res) {
  /**
    Saves the annotations to the database
    Annotate.html will make an HTTP POST that contains all the annotations.
    The body of the request include all the parameters encoded in JSON
  **/
  console.log('---- save annotations ----')

  let filename = req.body['filename']
  let segments = req.body['segments']
  //let points = req.body['points']
  let user = req.body['user']

  // if (user == 'admin') {
  //   console.log('admin cannot do removes')
  //   res.end();
  //   return;
  // }

  //row = db.prepare('SELECT id FROM wavefiles WHERE audiofile=?').get(filename);
  //fileid = row.id
  //console.log('filename', filename, '==>', fileid)

  var userid = db.prepare('SELECT id FROM users WHERE user=?').get(user).id
  console.log('user', user, '==>', userid)

  console.log(segments);
  saveSegsOrPoints(userid, filename, segments)
  //saveSegsOrPoints(user, fileName, points)

  res.end()
  console.log('---- save annotations ---- (end)')
})

app.use('/savelabels/', function(req, res) {
  /**
    Saves the annotations to the database
    Annotate.html will make an HTTP POST that contains all the annotations.
    The body of the request include all the parameters encoded in JSON
  **/
  console.log('---- save labels ----');

  let filename = req.body['filename'];
  let label = req.body['label'];
  let speaker = req.body['speaker'];
  //let points = req.body['points'];
  let user = req.body['user'];

  // if (user == 'admin') {
  //   console.log('admin cannot do removes')
  //   res.end();
  //   return;
  // }

  //row = db.prepare('SELECT id FROM wavefiles WHERE audiofile=?').get(filename);
  //fileid = row.id
  //console.log('filename', filename, '==>', fileid)

  var userid = db.prepare('SELECT id FROM users WHERE user=?').get([user]);
  console.log('user', user, '==>', userid);

  var r = db.prepare('SELECT speakers FROM labels where user_id=? AND audiofile=? AND label=?').get([userid.id, filename, label]);
  console.log(r);

  if (r != null){
    r.speakers += "|" + speaker;
    db.prepare('UPDATE labels SET speakers=? WHERE user_id=? AND audiofile=? AND label=?').run([r.speakers, userid.id, filename, label]);
  }
  else{
    db.prepare('INSERT INTO labels(user_id,audiofile,label,speakers) VALUES(?,?,?,?)').run([userid.id, filename, label, speaker]);
  }

  res.end();
  console.log('---- save annotations ---- (end)');
})

app.use('/loadlabels/', function(req, res){
  /**
    Loads the annotations from the database for a given user and file
    When the annotate.html loads, it will make request to load all the annotatiosn for the current file
  **/
    console.log('---- load labels ----')
    //console.log(req.body)
    let filename = req.body['filename']
    let user = req.body['user']
    console.log('user', user, 'audiofile', audiofile)
  
    // obtain the id of the user based on its user  
    var userid = db.prepare('SELECT id FROM users WHERE user=?').get(user).id
    console.log('user', user, '==>', userid)
  
    r = db.prepare('SELECT label, speakers FROM labels where user_id=? AND audiofile=?').all([userid, filename])

    console.log('retrieved', r.length, 'labels')
    console.log(r)
  
    res.send(r)
    console.log(`---- load labels ---- (end) total=${r.length}`)
    res.end()
});

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
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
