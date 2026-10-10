#!/bin/bash
# The iOS build compiles a Metal shader: SwiftTerm (modules/herdr-terminal)
# ships one for its GPU renderer. Xcode 26 no longer bundles the Metal
# toolchain; without it the build fails in SwiftTerm_SwiftTerm with "cannot
# execute tool 'metal' due to missing Metal Toolchain". Install it when it is
# missing, so a fresh Mac or a CI runner builds like this one.
set -euo pipefail

if xcodebuild -showComponent MetalToolchain 2>/dev/null | grep -q 'Status: installed'; then
  exit 0
fi
echo "==> Installing Xcode's Metal toolchain (SwiftTerm compiles a shader)…"
xcodebuild -downloadComponent MetalToolchain
