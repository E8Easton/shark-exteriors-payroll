const serverless = require('serverless-http');
const createApp = require('../../app');

const app = createApp();

exports.handler = serverless(app);
