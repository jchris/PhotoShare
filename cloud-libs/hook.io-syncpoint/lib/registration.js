//
// registration hook - application to handle registring devices with your server
// this is the cloud hook to run against the server replica, it does stuff like
// send confirmation emails and stuff
//
var Hook = require('hook.io').Hook
    , util = require('util')
    , colors = require('colors')
    , docstate = require("./docstate")
    , coux = require("./coux-request").coux
    , errLog = require("./errlog").errLog
    ;

var Registration = exports.Registration = function(config){

    var self = this;

    Hook.call(self, config);

    self.on('hook::ready', function(){
        console.log("starting new Registration hook for ", config.cloud.green);
        console.log("                     Device config ", config.device.green);

        var control = self.setupControl(config);

        self.on('*::change', function(change){
            control.handle(change.doc)
        });
    });
};

// CouchHook inherits from Hookf
util.inherits(Registration, Hook);

Registration.prototype.setupControl = function(config){
    var controlDb = config.cloud;
    var self = this;
    
    var control = docstate.control(config.cloud)
    
    control.safe("confirm","clicked", function(doc) {
        var confirm_code = doc.confirm_code;
        var device_code = doc.device_code;
        // load the device doc with confirm_code == code
        // TODO use a real view

        coux([controlDb, "_all_docs", {include_docs : true}], errLog(function(err, view) {
            var deviceDoc;
            // console.log("rows", view.rows)
            view.rows.forEach(function(row) {
               if (row.doc.confirm_code && row.doc.confirm_code == confirm_code &&
                   row.doc.device_code && row.doc.device_code == device_code &&
                   row.doc.type && row.doc.type == "device") {
                   deviceDoc = row.doc;
               }
            });
            if (deviceDoc) {
                deviceDoc.state = "confirmed";
                coux.put([controlDb, deviceDoc._id], deviceDoc, function(err, ok) {
                    doc.state = "used";
                    // db.insert(doc, errLog);
                    coux.put([controlDb, doc._id], doc, errLog);
                });
            } else {
                doc.state = "error";
                doc.error = "no matching device";
                coux.put([controlDb, doc._id], doc, errLog);
                // db.insert(doc, errLog);
            }
        }));
    });

    control.safe("device", "confirmed", function(deviceDoc) {
        // now we need to ensure the user exists and make sure the device has a delegate on it
        // move device_creds to user document, now the device can use them to auth as the user
        ensureUserDoc(userDb, deviceDoc.owner, function(err, userDoc) {
            userDoc = applyOAuth(userDoc, deviceDoc._id, deviceDoc.oauth_creds);
            coux.put(["_users", userDoc._id], userDoc, function(err) {
              if (err) {
                errLog(err, deviceDoc.owner)
              } else {
                  // set the config that we need with oauth user doc capability
    setOAuthConfig(userDoc, deviceDoc._id, deviceDoc.oauth_creds, server, function(err) {
                    if (!err) {
                        deviceDoc.state = "active";
                        coux.put([controlDb, deviceDoc._id], deviceDoc, errLog);          
                        // db.insert(deviceDoc, errLog);
                    }
                });
              }
            })
        });
    });

    control.unsafe("device", "new", function(doc) {
      var confirm_code = Math.random().toString().split('.').pop(); // todo better entropy
      var link = config.cloud + "/_design/channels/verify.html#" + confirm_code;
      sendEmail(self, doc.owner, confirm_code, function(err) {
        if (err) {
          errLog(err)
        } else {
          doc.state = "confirming";
          doc.confirm_code = confirm_code;
          coux.put([controlDb, doc._id], doc, errLog);          
        }
      });
    });

    return control;
}


function sendEmail(hook, address, link, cb) {
    var email = {
        to : address,
        from : "jchris@couchbase.com",
        subject : 'Confirm Sync',
        body : 'To sync your phone with the sharing server, click this link:\n\n' 
        + link
    };
    hook.emit("sendEmail", email)
// how do we get an ack that that email was delivered?
    cb(false);
}


function ensureUserDoc(userDb, name, fun) {
    var user_doc_id = "org.couchdb.user:"+name;
    userDb.get(user_doc_id, function(err, r, userDoc) {
        if (err && err.status_code == 404) {
            fun(false, {
                _id : user_doc_id,
                type : "user",
                name : name,
                roles : []
            });
        } else {
            fun(false, userDoc);
        }
    });
}

function setOAuthConfig(userDoc, id, creds, server, cb) {
    var rc = 0, ops = [
        ["oauth_consumer_secrets", creds.consumer_key, creds.consumer_secret],
        ["oauth_token_users", creds.token, userDoc.name],
        ["oauth_token_secrets", creds.token, creds.token_secret]
    ];
    for (var i=0; i < ops.length; i++) {
        var op = ops[i];
        server.request({
            method : "PUT",
            db : "_config", doc : op[0], att : op[1], body : op[2]
        }, function(err) {
            if (err) {
                cb(err)
            } else {
                rc += 1;
                if (rc == ops.length) {
                    cb(false)
                }
            }
        });
    };
}


function applyOAuth(userDoc, id, creds) {
    userDoc.oauth = userDoc.oauth || {
        consumer_keys : {},
        tokens : {},
    };
    userDoc.oauth.devices = userDoc.oauth.devices || {};
    if (userDoc.oauth.consumer_keys[creds.consumer_key] || userDoc.oauth.tokens[creds.token]) {
        throw({error : "token_used", message : "device_id "+id})
    }
    userDoc.oauth.devices[id] = [creds.consumer_key, creds.token];
    userDoc.oauth.consumer_keys[creds.consumer_key] = creds.consumer_secret;
    userDoc.oauth.tokens[creds.token] = creds.token_secret;
    return userDoc;
};