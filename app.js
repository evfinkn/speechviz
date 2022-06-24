var express = require('express');
var path = require('path');
var fs = require("fs");
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');

var index = require('./routes/index');
var login = require('./routes/login');
var app = express();

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
    if (!req.session || !req.session.authenticated) { res.redirect('/login'); }
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
app.use('/login', login);

app.get("/filelist", (req, res) => {
  res.send(fs.readdirSync("data/audio").filter(fileName => fileName != ".DS_Store"));
});

app.get(/\/audio/, (req, res) => res.sendFile(req.url, {root: __dirname + "/data"}));
app.get(/\/segments/, (req, res) => res.sendFile(req.url, {root: __dirname + "/data"}));
app.get(/\/waveforms/, (req, res) => res.sendFile(req.url, {root: __dirname + "/data"}));

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
