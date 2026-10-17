// Makes the Android tab bar 64dp tall instead of Material 3's 80dp.
//
// react-native-screens builds the bar inside its own Material 3 theme, so
// neither a prop nor the app theme reaches its height. Library dimens can be
// overridden by the app's own resources, so these three set it: 32dp
// indicator + label + 6dp above and below, the height of Material 3's
// "flexible" navigation bar.
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const DIMENS = {
  m3_bottom_nav_min_height: '64dp',
  m3_bottom_nav_item_padding_top: '6dp',
  m3_bottom_nav_item_padding_bottom: '6dp',
};

function dimensXml() {
  const items = Object.entries(DIMENS).map(([name, value]) => `  <dimen name="${name}" tools:override="true">${value}</dimen>`);
  return `<?xml version="1.0" encoding="utf-8"?>\n<resources xmlns:tools="http://schemas.android.com/tools">\n${items.join('\n')}\n</resources>\n`;
}

function withCompactTabBar(config) {
  return withDangerousMod(config, ['android', (mod) => {
    const dir = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res/values');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'tab_bar_dimens.xml'), dimensXml());
    return mod;
  }]);
}

module.exports = withCompactTabBar;
module.exports.dimensXml = dimensXml;
