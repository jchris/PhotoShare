var docstate = require("docstate")
    , coux = require("coux")
    ;



function errLog(err, resp) {
  if (err) {
      if (err.message) {
          console.error(err.status_code, err.error, err.message)
      } else {
          console.error(err, resp)          
      }
  }
};



//
// couch-control hook - application to handle registring devices with your server
// this is the cloud hook to run against the server replica, it does stuff like
// send confirmation emails and stuff
//
var Hook = require('hook.io').Hook,
    util = require('util');

var SyncPoint = exports.SyncPoint = function(config){

  var self = this;

  Hook.call(self, config);

  self.on('hook::ready', function(){
    console.log("syncpoint", config)
    self._start(config);
    
  });

};

// CouchHook inherits from Hookf
util.inherits(SyncPoint, Hook);

SyncPoint.prototype._start = function(config){
    var c = config.cloud.split('/');
    var db_name = c.pop(), db_host = c.join('/');
    var control = docstate.connect(config.cloud)
        , server = nano(db_host)
        , db = server.use(db_name)
        ;
    
    handleDevices(this, control, db, server);
    handleChannels(this, control, db, server);
    
    control.start();
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
    // console.warn("not actually sending an email", address, code)
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

function handleDevices(hook, control, db, server) {
    var userDb = server.use("_users");
    control.safe("confirm","clicked", function(doc) {
        var confirm_code = doc.confirm_code;
        var device_code = doc.device_code;
        // load the device doc with confirm_code == code
        // TODO use a real view
        db.list({include_docs:true}, function(err, r, view) {
            var deviceDoc;
            view.rows.forEach(function(row) {
               if (row.doc.confirm_code && row.doc.confirm_code == confirm_code &&
                   row.doc.device_code && row.doc.device_code == device_code &&
                   row.doc.type && row.doc.type == "device") {
                   deviceDoc = row.doc;
               }
            });
            if (deviceDoc) {
                deviceDoc.state = "confirmed";
                db.insert(deviceDoc, function(err, ok) {
                    doc.state = "used";
                    db.insert(doc, errLog);
                });
            } else {
                doc.state = "error";
                doc.error = "no matching device";
                db.insert(doc, errLog);
            }
        });
    });

    control.safe("device", "confirmed", function(deviceDoc) {
        // now we need to ensure the user exists and make sure the device has a delegate on it
        // move device_creds to user document, now the device can use them to auth as the user
        ensureUserDoc(userDb, deviceDoc.owner, function(err, userDoc) {
            userDoc = applyOAuth(userDoc, deviceDoc._id, deviceDoc.oauth_creds);
            userDb.insert(userDoc, function(err) {
              if (err) {
                errLog(err, deviceDoc.owner)
              } else {
                  // set the config that we need with oauth user doc capability
    setOAuthConfig(userDoc, deviceDoc._id, deviceDoc.oauth_creds, server, function(err) {
                    if (!err) {
                        deviceDoc.state = "active";
                        db.insert(deviceDoc, errLog);
                        hook.emit("activedDevice", deviceDoc._id)
                    }
                });
              }
            })
        });
    });

    control.unsafe("device", "new", function(doc) {
      var confirm_code = Math.random().toString().split('.').pop(); // todo better entropy
      var link = config.cloud + "/_design/channels/verify.html#" + confirm_code;
      sendEmail(hook, doc.owner, confirm_code, function(err) {
        if (err) {
          errLog(err)
        } else {
          doc.state = "confirming";
          doc.confirm_code = confirm_code;
          db.insert(doc, errLog);      
        }
      });
    });

};


function handleChannels(hook, control, db, server) {
    control.safe("channel", "new", function(doc) {
        var db_name = "db-"+doc._id;
        if (doc["public"]) {
            errLog("PDI","please implement public databases")
        } else {
            server.db.create(db_name, function(err, resp) {
                if (err && err.code != 412) {
                    // 412 means the db already exists
                    doc.state = "error";
                    doc.error = "db_name exists: "+db_name;
                    db.insert(doc, errLog);
                    errLog(err, resp);
                } else {
                    // only set up creds the first time
                    coux([db_name, "_security"],function(err, sec) {
                        if (err) {sec = {members:{names:[],roles:[]}}}
                        sec.members.names.push(doc.owner)
                    });
                    doc.state = "ready";
                    doc.syncpoint = PUBLIC_HOST_URL + db_name;
                    db.insert(doc, errLog);
                }
            });
        }
    });

    control.safe("channel", "ready", function(doc) {
        var channel_db = urlDb(doc.syncpoint);
        channel_db.insert({
            _id : 'description',
            name : doc.name
        }, errLog);
    });
};

