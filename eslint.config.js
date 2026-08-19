const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // Generated or not ours. `.remember/` is a local tool's scratch directory —
    // gitignored, so CI never sees it, and linting it made the local run
    // disagree with the one that gates a pull request.
    ignores: ['dist/*', 'ios/*', 'android/*', '.expo/*', '.remember/*'],
  },
]);
