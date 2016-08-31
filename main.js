#!/usr/bin/env node
'use strict';

const path = require('path');
const express = require('express');
const api = require('./api.js');

function main() {
    api.setup().then(() => {
        console.log("API initialized");
        const app = express();
        app.use(path.join(api.baseUrl.pathname, '/api'), api.router);
        app.use(api.baseUrl.pathname, express.static(__dirname + '/ui'));
        app.listen(80);
    }).catch(e => {
        console.log(e);
        process.exit(1);
    });
}

module.exports = {
    api: api,
    main: main,
};

if (require.main === module) {
    main();
}
