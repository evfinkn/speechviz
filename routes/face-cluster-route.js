var express = require('express');
var router = express.Router();

var dir = /faceClusters/video1.mp4/testLabel0/


/* GET home page. */
router.get('/', (req, res, next) => {
    res.render("facecluster");
    file = req.query.file;
    test = req.query.test;
    
    fs.readdir(dir, function(err, files){
        res.render
        res.render("clusteredFaces", { images: files, directory: dir });
    });
});

module.exports = router;
