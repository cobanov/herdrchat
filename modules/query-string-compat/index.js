// SDK 57 uses named CommonJS exports. Keep that API with the patched decoder.
// Remove this facade when Expo Router imports the upstream default export.
module.exports = require('query-string-modern').default;
