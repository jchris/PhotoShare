var  request = require("request")
    , qs = require('querystring');
// coux is a tiny couch client, there are implementations for server side and client side
// this implementation is for Zepto or jQuery.

var coux = exports.coux = function(opts, body) {
    if (typeof opts === 'string' || Array.isArray(opts)) { 
        opts = {url:opts};
    }
    var cb = arguments[Math.max(1,arguments.length -1)] || function() {console.log("empty callback", opts)};

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
        headers : {
            'content-type': 'application/json'            
        }
    };
    for (var x in opts) {
        if (opts.hasOwnProperty(x)){
            req[x] = opts[x];
        }
    }
    console.log('coux', req.method, req.url);
    request(req, function(err, resp, body) {
        console.log('done', req.method, req.url);
        if (err) {
            cb(err, resp, body)
        } else if (resp.statusCode >= 400) {
            try {
                var cerr = JSON.parse(body);
                cb(cerr, resp);
            } catch(e) {
                cb(e, body)
            }
        } else {
            try {
                cb(false, JSON.parse(body))
            } catch(e) {
                cb(e, body)
            }
        }
    });
};

coux.put = function() {
    var opts = arguments[0];
    if (typeof opts === 'string' || Array.isArray(opts)) { 
        opts = {url:opts};
    }
    opts.method = "PUT";
    arguments[0] = opts;
    coux.apply(null, arguments);
};

coux.post = function() {
    var opts = arguments[0];
    if (typeof opts === 'string' || Array.isArray(opts)) { 
        opts = {url:opts};
    }
    opts.method = "POST";
    arguments[0] = opts;
    coux.apply(null, arguments);
};

coux.del = function() {
    var opts = arguments[0];
    if (typeof opts === 'string' || Array.isArray(opts)) { 
        opts = {url:opts};
    }
    opts.method = "DELETE";
    arguments[0] = opts;
    coux.apply(null, arguments);
};