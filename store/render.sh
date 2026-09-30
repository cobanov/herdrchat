#!/usr/bin/env bash
# Render the App Store pictures from slides.html into out/.
#
#   store/render.sh            every slide, both sets
#   store/render.sh iphone 3   one slide
#
# Headless Chrome draws each slide at its exact store size (iPhone 6.9"
# 1320x2868, iPad 13" 2752x2064), so there is no resampling step to blur text.
set -euo pipefail
cd "$(dirname "$0")"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
mkdir -p out

render() {
  local set=$1 n=$2 size
  if [ "$set" = ipad ]; then size=2752,2064; else size=1320,2868; fi
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --force-device-scale-factor=1 --window-size="$size" --virtual-time-budget=3000 \
    --screenshot="out/$set-$n.png" "file://$PWD/slides.html?set=$set&n=$n" 2>/dev/null
  # The store rejects an alpha channel.
  sips -s format png -s formatOptions default "out/$set-$n.png" >/dev/null
  echo "out/$set-$n.png"
}

if [ $# -eq 2 ]; then render "$1" "$2"; exit; fi
for n in 1 2 3 4 5 6 7 8; do render iphone "$n"; done
for n in 1 2; do render ipad "$n"; done
