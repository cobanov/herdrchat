// Gives the Android theme the app's accent, so the controls Android draws
// itself stop being teal.
//
// Without a colorAccent the AppCompat theme falls back to its own teal, and
// every native control that reads it shows it: the text cursor and selection
// handles, the selection highlight (a hard-coded teal of its own, hence the
// second colour), and the occasional system dialog. JS styling cannot reach
// any of them.
//
// Light and dark both, through values-night: the app's own Light/Dark choice
// reaches native resources because Appearance.setColorScheme sets the
// AppCompat night mode. The colours are the palette's `tint`, written out here
// because a plugin runs in Node and cannot import the theme; a test holds them
// to `src/theme/tokens.ts`.
const { AndroidConfig, withAndroidColors, withAndroidColorsNight, withAndroidStyles } = require('expo/config-plugins');

const ACCENT = { light: '#5459D4', dark: '#8288F0' };
// The accent at 30% (ARGB), so selected text stays readable under it.
const HIGHLIGHT = { light: '#4D5459D4', dark: '#4D8288F0' };

function setColors(colors, scheme) {
  let next = AndroidConfig.Colors.setColorItem(
    AndroidConfig.Resources.buildResourceItem({ name: 'colorAccent', value: ACCENT[scheme] }),
    colors
  );
  next = AndroidConfig.Colors.setColorItem(
    AndroidConfig.Resources.buildResourceItem({ name: 'textHighlight', value: HIGHLIGHT[scheme] }),
    next
  );
  return next;
}

function withAndroidAccent(config) {
  config = withAndroidColors(config, (mod) => {
    mod.modResults = setColors(mod.modResults, 'light');
    return mod;
  });
  config = withAndroidColorsNight(config, (mod) => {
    mod.modResults = setColors(mod.modResults, 'dark');
    return mod;
  });
  return withAndroidStyles(config, (mod) => {
    const parent = AndroidConfig.Styles.getAppThemeGroup();
    for (const [name, value] of [
      ['colorAccent', '@color/colorAccent'],
      ['android:textColorHighlight', '@color/textHighlight'],
    ]) {
      mod.modResults = AndroidConfig.Styles.assignStylesValue(mod.modResults, {
        add: true,
        parent,
        name,
        value,
      });
    }
    return mod;
  });
}

module.exports = withAndroidAccent;
module.exports.ACCENT = ACCENT;
module.exports.HIGHLIGHT = HIGHLIGHT;
