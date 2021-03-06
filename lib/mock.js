/*
 * grunt-mock-s3
 * https://github.com/MathieuLoutre/grunt-mock-s3
 *
 * Copyright (c) 2013 Mathieu Triay
 * Licensed under the MIT license.
 */

'use strict';

var _ = require('underscore');
var fs = require('fs-extra');
var crypto = require('crypto');
var path = require('path');
var Buffer = require('buffer').Buffer;
var mkdirp = require('mkdirp');

exports.baseDir = "";

function getPath( search ){
    return path.join( exports.baseDir ||"",  search.Bucket||"", search.Key||"" )
}

// Gathered from http://stackoverflow.com/questions/5827612/node-js-fs-readdir-recursive-directory-search
exports.walk = function (dir) {

    var results = [];
    var list = fs.readdirSync(dir);

    list.forEach(function (file) {

        file = dir + '/' + file;
        var stat = fs.statSync(file);

        if (stat && stat.isDirectory()) {
            results = results.concat(exports.walk(file));
        }
        else {
            results.push(file);
        }
    });

    return results;
};

exports.S3 = function (options) {

    exports.endpoint = {
        href: ''
    };
    return exports;
};

exports.listObjects = function (search, callback) {

    var files = exports.walk(search.Bucket);

    var filtered_files = _.filter(files, function (file) {
        return file.replace(search.Bucket + '/', '').indexOf(search.Prefix) === 0;
    });
    var start = 0;
    var marker = null;
    var truncated = false;

    if (search.Marker) {
        var startFile = _(filtered_files).find(function (file) {
            return file.indexOf(search.Bucket + '/' + search.Marker) === 0
        });
        start = filtered_files.indexOf(startFile);
    }

    filtered_files = _.rest(filtered_files, start);

    if (filtered_files.length > 1000) {
        truncated = true;
        filtered_files = filtered_files.slice(0, 1000);
    }

    var result = {
        Contents: _.map(filtered_files, function (path) {

            return {
                Key: path.replace(search.Bucket + '/', ''),
                ETag: '"' + crypto.createHash('md5').update(fs.readFileSync(path)).digest('hex') + '"',
                LastModified: fs.statSync(path).mtime
            };
        }),
        IsTruncated: truncated
    };

    if (truncated) {
        result.Marker = _.last(result.Contents).Key;
    }

    callback(null, result);
};

exports.deleteObjects = function (search, callback) {

    var deleted = [];
    var errors = [];

    _.each(search.Delete.Objects, function (file) {

        var filePath = getPath(_.extend( {},search, {Key: file.Key } ));
        if (fs.existsSync(filePath)) {
            deleted.push(file);
            fs.unlinkSync(filePath);
        }
        else {
            errors.push(file);
        }
    });

    if (errors.length > 0) {
        callback("Error deleting objects", {Errors: errors, Deleted: deleted});
    }
    else {
        callback(null, {Deleted: deleted});
    }
};

exports.deleteObject = function (search, callback) {

    if (fs.existsSync(getPath(search))) {
        fs.unlinkSync(getPath(search));
        callback(null, true);
    }
    else {
        callback("Error deleting object");
    }
};

function FakeStream(search) {
    this.src =getPath(search);
}

FakeStream.prototype.createReadStream = function () {
    return fs.createReadStream(this.src)
        .on('error', function( err ) {
            if ( err.code == "ENOENT" )
                err.statusCode = 404;
        })
};



exports.getObject = function (search, callback) {
    if (!callback) {
        return new FakeStream(search);
    }
    else {
        fs.readFile(getPath(search), function (err, data) {

            if (!err) {
                callback(null, {
                    Key: search.Key,
                    ETag: '"' + crypto.createHash('md5').update(data).digest('hex') + '"',
                    Body: data,
                    ContentLength: data.length
                });
            }
            else {
                callback(err, search);
            }
        });
    }
};

exports.copyObject = function (search, callback) {

    fs.mkdirsSync(path.dirname(getPath(search)));

    fs.copy(decodeURIComponent(search.CopySource), getPath(search), function (err, data) {

        callback(err, search);
    });
};

exports.putObject = function (search, callback) {

    var dest = getPath(search);

    if (typeof search.Body === 'string') {
        search.Body = new Buffer(search.Body);
    }

    if (search.Body instanceof Buffer) {
        fs.createFileSync(dest);
        fs.writeFile(dest, search.Body, function (err) {
            callback(err);
        });
    }
    else {
        fs.mkdirsSync(path.dirname(dest));

        var stream = fs.createWriteStream(dest);

        stream.on('finish', function () {
            callback(null, true);
        });

        search.Body.on('error', function (err) {
            callback(err);
        });

        stream.on('error', function (err) {
            callback(err);
        });

        search.Body.pipe(stream);
    }
};

exports.createBucket = function (search, callback) {
    var bucket = search.Bucket;
    fs.mkdirp(bucket, callback);
};
