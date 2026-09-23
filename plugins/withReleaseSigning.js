// Signs Android release builds with the Play upload key when its credentials
// are present, and leaves them on the debug key otherwise.
//
// A config plugin because android/ is generated (CNG) and hand edits are lost
// on every prebuild. The credentials come from the environment, never from the
// repository: HERDRCHAT_STORE_FILE and HERDRCHAT_STORE_PASSWORD, plus
// HERDRCHAT_KEY_ALIAS (default "upload") and HERDRCHAT_KEY_PASSWORD (default:
// the store password). Without them a clone still builds; scripts/android-release.sh
// refuses to call such a build a release.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARK = '// herdrchat: upload key';

const SIGNING = `
        ${MARK} (plugins/withReleaseSigning.js)
        if (System.getenv('HERDRCHAT_STORE_FILE') && System.getenv('HERDRCHAT_STORE_PASSWORD')) {
            release {
                storeFile file(System.getenv('HERDRCHAT_STORE_FILE'))
                storePassword System.getenv('HERDRCHAT_STORE_PASSWORD')
                keyAlias System.getenv('HERDRCHAT_KEY_ALIAS') ?: 'upload'
                keyPassword System.getenv('HERDRCHAT_KEY_PASSWORD') ?: System.getenv('HERDRCHAT_STORE_PASSWORD')
            }
        }`;

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    let gradle = mod.modResults.contents;
    if (gradle.includes(MARK)) return mod;

    const debugKey = /(signingConfigs\s*\{\s*debug\s*\{[^}]*\})/;
    if (!debugKey.test(gradle)) throw new Error('withReleaseSigning: no signingConfigs.debug block to extend');
    gradle = gradle.replace(debugKey, `$1${SIGNING}`);

    const release = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
    if (!release.test(gradle)) throw new Error('withReleaseSigning: release build type does not use signingConfigs.debug');
    gradle = gradle.replace(release, "$1signingConfig signingConfigs.findByName('release') ?: signingConfigs.debug");

    mod.modResults.contents = gradle;
    return mod;
  });
}

module.exports = withReleaseSigning;
