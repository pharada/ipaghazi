'use strict';

const crypto = require('crypto');
const fs = require('fs');
const url = require('url');
const path = require('path');
const util = require('util');

const dateformat = require('dateformat');
const unzip = require('unzip');
const plist = require('simple-plist');
const express = require('express');
const bodyparser = require('body-parser');
const mongoose = require('mongoose');
mongoose.Promise = global.Promise;

const models = require('./models.js');
const {App, Buildref, Build, User} = models;

const api = express.Router();
const baseUrl = url.parse(process.env.IPAGHAZI_BASEURL);

api.route('/app').get(requirePermissions([
    'browse-app',
]), function (req, res) {
    App.find().then(apps => res.json({apps: apps.map(representApp)})).catch(errorFallback(res));
});

api.route('/app/:app').get(requirePermissions([
    'browse-app',
]), function (req, res) {
    let app;
    App.findOne({name: req.params.app}).then(app_ => {
        if (!app_)
            throw new JsonableError(404, "no such app");
        app = app_;
        return Buildref.find({_app: app._id});
    }).then(buildrefs => {
        let refdir = {};
        models.validRefTypes.forEach(t => {
            refdir[t] = buildrefs.filter(r => r.type == t).map(r => r.name);
        });
        res.json({
            name: app.name,
            description: app.description,
            refs: refdir,
        });
    }).catch(errorFallback(res));
}).patch(requirePermissions([
    'modify-app',
]), bodyparser.json(), function (req, res) {
    let app;
    App.findOne({name: req.params.app}).then(app_ => {
        if (!app_)
            throw new JsonableError(404, "no such app");
        app = app_;
        if (req.body.description !== undefined)
            app.description = req.body.description;
        return app.save();
    }).then(() => res.json(representApp(app))).catch(errorFallback(res));
});

api.route('/app/:app/:reftype').get(requirePermissions([
    'browse-app',
]), function (req, res) {
    let app;
    App.findOne({name: req.params.app}).then(app_ => {
        if (!app_)
            throw new JsonableError(404, "no such app");
        app = app_;
        if (!models.validRefTypes.includes(req.params.reftype))
            throw new JsonableError(400, util.format("valid ref types are: %s",
                                                     models.validRefTypes.join(", ")));
        return Buildref.find({_app: app._id, type: req.params.reftype});
    }).then(buildrefs => {
        res.json({refs: buildrefs.map(r => r.name)});
    }).catch(errorFallback(res));
});

api.route('/app/:app/:reftype/:ref').get(requirePermissions([
    'browse-app',
]), function (req, res) {
    let app, ref;
    App.findOne({name: req.params.app}).then(app_ => {
        if (!app_)
            throw new JsonableError(404, "no such app");
        app = app_;
        return Buildref.findOne({_app: app._id, type: req.params.reftype,
                                 name: req.params.ref});
    }).then(buildref_ => {
        if (!buildref_)
            throw new JsonableError(404, "no such ref");
        ref = buildref_;
        return Build.find({_buildref: ref._id}).sort('-date').limit(10000);
    }).then(builds => {
        res.json({
            latest: builds.length ? dateformat(builds[0].date, 'isoUtcDateTime') : null,
            builds: builds.map(b => b._id.valueOf()),
        });
    }).catch(errorFallback(res));
});

function saveOrGetExisting(mdl, q) {
    return new mdl(q).save().catch(e => e.code == 11000 ?
                                   mdl.findOne(q) : Promise.reject(e));
}

function representApp(app) {
    return {
        name: app.name,
        description: app.description,
    };
}

function representBuild(build) {
    return {
        id: build._id.valueOf(),
        app: build._app.name,
        ref: {type: build._buildref.type, name: build._buildref.name},
        date: dateformat(build.date, 'isoUtcDateTime'),
        user: build.user,
        method: build.method,
        'method-params': build.methodParams,
    };
}

function JsonableError(status, message) {
    if (!(this instanceof JsonableError))
        return new JsonableError();
    this.status = status;
    this.json = {error: message};
}

function errorFallback(res) {
    return e => {
        console.log(e);
        res.set('Content-Type', 'application/json');
        if (e instanceof JsonableError)
            res.status(e.status).json(e.json);
        else
            res.status(500).json({error: "internal error"});
    };
}

const methods = {
    file: function (params) {
        return Promise.resolve(fs.createReadStream(params.path));
    },
    url: (function () {
        const request = require('request');
        return function (params) {
            return Promise.resolve(request(params.url));
        };
    })(),
    s3: (function () {
        const AWS = require('aws-sdk');
        const S3 = new AWS.S3();
        return function (params) {
            return Promise.resolve(S3.getObject({
                Bucket: params.bucket,
                Key: params.key,
            }).createReadStream());
        };
    })(),
};

function retrieveAppStream(method, params) {
    if (!methods.hasOwnProperty(method)) {
        return Promise.reject(new JsonableError(500, "unknown app method"));
    }
    else if (!(process.env.IPAGHAZI_METHODS || '').split(/\s+/).includes(method)) {
        return Promise.reject(new JsonableError(500, "disabled app method"));
    }
    return methods[method](params);
}

function requirePermissions(reqperms) {
    function keycmp(a, b) {
        if (a.length != b.length)
            return false;
        let eq = 1;
        for (let i = 0; i < a.length; ++i)
            eq &= a[i] === b[i];
        return !!eq;
    }
    const badauth = new JsonableError(403, "invalid credentials");
    const resolvePerms = req => new Promise((resolve, reject) => {
        const user = req.get('x-ipaghazi-user') || req.query.user;
        const key = req.get('x-ipaghazi-key') || req.query.key;
        if (user && key) {
            if (process.env.IPAGHAZI_ROOT_USER && process.env.IPAGHAZI_ROOT_KEY &&
                user === process.env.IPAGHAZI_ROOT_USER && keycmp(key, process.env.IPAGHAZI_ROOT_KEY)) {
                return resolve({user: user, perms: models.validPermissions});
            }
            return User.findOne({name: user}).then(u => {
                return (u && u.keys.map(k => keycmp(key, k)).includes(true) ?
                        resolve({user: user, perms: u.permissions}) : reject(badauth));
            }).catch(reject);
        }
        return resolve({
            user: "",
            perms: (process.env.IPAGHAZI_ANON_PERMS || '').split(/\s+/)
                .filter(x => models.validPermissions.includes(x)),
        });
    });
    return (req, res, next) => {
        resolvePerms(req).then(({user, perms}) => {
            if (!reqperms.map(x => perms.includes(x)).includes(false)) {
                req.user = user;
                return next();
            }
            else
                return Promise.reject(new JsonableError(403, "insufficient permissions"));
        }).catch(errorFallback(res));
    };
}

api.route('/build').post(requirePermissions([
    'create-build',
]), bodyparser.json(), function (req, res) {
    const body = req.body;
    let app, buildref;
    saveOrGetExisting(App, {name: req.body.app}).then(app_ => {
        app = app_;
        return saveOrGetExisting(Buildref, {
            _app: app,
            type: req.body.ref.type,
            name: req.body.ref.name,
        });
    }).then(buildref_ => {
        buildref = buildref_;
        return new Build({
            _app: app,
            _buildref: buildref,
            date: new Date(req.body.date || Date.now()),
            user: req.user,
            method: req.body.method,
            methodParams: req.body['method-params'] || {},
        }).save();
    }).then(build => {
        res.json(representBuild(build));
    }).catch(errorFallback(res));
});

api.route('/build/:id').get(requirePermissions([
    'browse-app',
]), function (req, res) {
    Build.findOne({_id: req.params.id}).populate('_app').populate('_buildref').then(build => {
        if (!build)
            throw new JsonableError(404, "no such build");
        res.json(representBuild(build));
    }).catch(errorFallback(res));
});

api.route('/build/:id/manifest').get(requirePermissions([
    'browse-app',
]), function (req, res) {
    Build.findOne({_id: req.params.id}).then(build => {
        if (!build)
            throw new JsonableError(404, "no such build");
        return retrieveAppStream(build.method, build.methodParams);
    }).then(stream => {
        stream.on('error', errorFallback(res));
        return new Promise((resolve, reject) => {
            const zip = stream.pipe(unzip.Parse());
            zip.on('error', e => reject(e));
            zip.on('entry', en => {
                if (en.path.match(/^Payload\/[^\/]+\.app\/Info.plist$/)) {
                    const bufs = [];
                    en.on('error', e => reject(e));
                    en.on('data', b => bufs.push(b));
                    en.on('end', () => {
                        resolve(plist.parse(Buffer.concat(bufs)));
                        zip.end();
                    });
                }
                else {
                    en.autodrain();
                }
            });
            zip.on('close', () => reject("no plist found"));
        });
    }).then(plistdata => {
        const ipa = url.format({
            protocol: baseUrl.protocol,
            hostname: baseUrl.hostname,
            pathname: path.normalize(path.join(req.originalUrl, '../ipa')),
            query: req.query,
        });
        const manifest = {items: [{
            assets: [{
                kind: 'software-package',
                url: ipa,
            }],
            metadata: {
                'bundle-identifier': plistdata.CFBundleIdentifier,
                'bundle-version': plistdata.CFBundleShortVersionString,
                kind: 'software',
                title: plistdata.CFBundleName,
            },
        }]};
        res.set('Content-Type', 'application/x-plist').send(plist.stringify(manifest) + '\n');
    }).catch(errorFallback(res));
});

api.route('/build/:id/ipa').get(requirePermissions([
    'browse-app',
]), function (req, res) {
    Build.findOne({_id: req.params.id}).then(build => {
        if (!build)
            throw new JsonableError(404, "no such build");
        return retrieveAppStream(build.method, build.methodParams);
    }).then(stream => {
        res.set('Content-Type', 'application/octet-stream');
        stream.on('error', errorFallback(res));
        stream.pipe(res);
    }).catch(errorFallback(res));
});

api.route('/user').get(requirePermissions([
    'browse-user',
]), function (req, res) {
    User.find().then(users => {
        res.json({users: users.map(x => x.name)});
    }).catch(errorFallback(res));
});

api.route('/user/:user').get(requirePermissions([
    'browse-user',
]), function (req, res) {
    User.findOne({name: req.params.user}).then(user => {
        if (!user)
            throw new JsonableError(404, "no such user");
        res.json({permissions: user.permissions, keys: user.keys});
    }).catch(errorFallback(res));
}).put(requirePermissions([
    'create-user',
]), bodyparser.json(), function (req, res) {
    new User({
        name: req.params.user,
    }).save().then(user => {
        res.json({permissions: user.permissions, keys: user.keys});
    }).catch(e => {
        return Promise.reject(e.code == 11000 ? new JsonableError(409, "already exists") : e);
    }).catch(errorFallback(res));
}).delete(requirePermissions([
    'delete-user',
]), function (req, res) {
    User.remove({name: req.params.user}).then(q => {
        if (!q.result.n)
            throw new JsonableError(404, "no such user");
        res.json({status: 'ok'});
    }).catch(errorFallback(res));
});

api.route('/user/:user/key').post(requirePermissions([
    'create-user-key',
]), function (req, res) {
    let key;
    new Promise((resolve, reject) => crypto.randomBytes(32, (err, data) => {
        if (err)
            return reject(err);
        key = data.toString('hex');
        resolve();
    })).then(() => User.update(
        {name: req.params.user},
        {$addToSet: {keys: key}}
    )).then(q => {
        if (!q.n)
            throw new JsonableError(404, "no such user");
        if (!q.nModified)
            throw new JsonableError(500, "failed to add key");
        res.json({key: key});
    }).catch(errorFallback(res));
}).delete(requirePermissions([
    'delete-user-key',
]), bodyparser.json(), function (req, res) {
    Promise.resolve().then(() => User.update(
        {name: req.params.user},
        {$pullAll: {keys: (req.body.keys || []).map(x => x.toString())}}
    )).then(q => {
        if (!q.n)
            throw new JsonableError(404, "no such user");
        res.json({status: 'ok'});
    }).catch(errorFallback(res));
});

api.route('/user/:user/perm').post(requirePermissions([
    'create-user-perm',
]), bodyparser.json(), function (req, res) {
    Promise.resolve().then(() => {
        if (req.body.permissions.map(x => models.validPermissions.includes(x))
            .includes(false)) {
            throw new JsonableError(400, "invalid permission");
        }
        return User.update(
            {name: req.params.user},
            {$addToSet: {permissions: {$each: (req.body.permissions || []).map(x => x.toString())}}}
        );
    }).then(q => {
        if (!q.n)
            throw new JsonableError(404, "no such user");
        res.json({status: 'ok'});
    }).catch(errorFallback(res));
}).delete(requirePermissions([
    'delete-user-perm',
]), bodyparser.json(), function (req, res) {
    Promise.resolve().then(() => User.update(
        {name: req.params.user},
        {$pullAll: {permissions: (req.body.permissions || []).map(x => x.toString())}}
    )).then(q => {
        if (!q.n)
            throw new JsonableError(404, "no such user");
        res.json({status: 'ok'});
    }).catch(errorFallback(res));
});

function setup() {
    function waitIndexes(m) {
        return new Promise((res, rej) => {
            m.on('index', x => (x instanceof Error ? rej : res)(x));
        });
    }
    mongoose.connect(process.env.IPAGHAZI_MONGODB);
    return Promise.all(models.allModels.map(waitIndexes));
}

module.exports = {
    baseUrl: baseUrl,
    router: api,
    setup: setup,
    JsonableError: JsonableError,
    errorFallback: errorFallback,
    methods: methods,
};
Object.assign(module.exports, models);
