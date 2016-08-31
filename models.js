'use strict';

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const appschema = new Schema({
    name: {
        type: String,
        unique: true,
        validate: /^\S+$/,
        required: true,
    },
    description: {
        type: String,
        default: "",
    },
});
const App = mongoose.model('App', appschema);

const validRefTypes = ['branch', 'tag'];
const buildrefschema = new Schema({
    _app: {
        type: Schema.Types.ObjectId,
        ref: 'App',
        required: true,
    },
    type: {
        type: String,
        enum: validRefTypes,
        required: true,
    },
    name: {
        type: String,
        validate: /^\S+$/,
        required: true,
    },
});
buildrefschema.index({_app: 1, type: 1, name: 1}, {unique: true});
const Buildref = mongoose.model('Buildref', buildrefschema);

const buildschema = new Schema({
    _app: {
        type: Schema.Types.ObjectId,
        ref: 'App',
        index: true,
        required: true,
    },
    _buildref: {
        type: Schema.Types.ObjectId,
        ref: 'Buildref',
        index: true,
        required: true,
    },
    date: {
        type: Date,
        index: true,
        required: true,
    },
    user: {
        type: String,
        required: true,
    },
    method: {
        type: String,
        required: true,
    },
    methodParams: {
        type: Schema.Types.Mixed,
        required: true,
    },
});
const Build = mongoose.model('Build', buildschema);

const validPermissions = [
    'browse-app', // List apps, refs, builds; retrieve apps
    'create-build',

    // Admin
    'browse-user',
    'create-user',
    'delete-user',
    'create-user-key',
    'delete-user-key',
    'create-user-perm',
    'delete-user-perm',
];
const userschema = new Schema({
    name: {
        type: String,
        index: true,
        required: true,
        unique: true,
    },
    keys: {
        type: [String],
        default: [],
    },
    permissions: {
        type: [{
            type: String,
            enum: validPermissions,
        }],
        default: [],
    },
});
const User = mongoose.model('User', userschema);

module.exports = {
    validRefTypes: validRefTypes,
    validPermissions: validPermissions,
    allModels: [App, Buildref, Build, User],
    App: App,
    Buildref: Buildref,
    Build: Build,
    User: User,
};
