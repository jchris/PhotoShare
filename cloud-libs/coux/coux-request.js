var  request = require("request")
    , qs = require('querystring')
    , colors = require('colors');
// coux is a tiny couch client, there are implementations for server side and client side
// this implementation is for Zepto or jQuery.

var coux = exports.coux = function(opts, body) {
    if (typeof opts === 'string' || Array.isArray(opts)) { 
        opts = {url:opts};
    }
    var cb = arguments[arguments.length -1];
    if (arguments.length == 3) {
        opts.body = JSON.stringify(body);
    }
    opts.url = opts.url || opts.uri;
    if (Array.isArray(opts.url)) {
        var first = true;
        if (typeof opts.url[opts.url.length-1] == 'object') {
            var query = qs.stringify(opts.url.pop());
        }
        opts.url = (opts.url.map(function(path) {
            if (first) {
                first = false;
                if (/^http/.test(path)) {
                    return path;                    
                }
            }
            return encodeURIComponent(path);
        })).join('/');
        if (query) {
            opts.url = opts.url + "?" + query;
        }
    }
    var req = {
        method: 'GET',
        contentType: 'application/json'
    };
    for (var x in opts) {
        if (opts.hasOwnProperty(x)){
            req[x] = opts[x];
        }
    }
    console.log(req.method.green, req.url);
    request(opts, function(err, resp, body) {
        if (err) {
            cb(err, resp, body)
        } else {
            try {
                cb(false, JSON.parse(body))
            } catch(e) {
                cb(e, body)
            }
        }
    });
};

coux.put = function(opts, body, cb) {
    if (typeof opts === 'string' || Array.isArray(opts)) { 
        opts = {url:opts};
    }
    opts.method = "PUT";
    coux(opts, body, cb);
};