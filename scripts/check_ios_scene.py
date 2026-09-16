"""Reject an iOS app that would fail to launch with the iOS 27 SDK."""

import plistlib
import sys


def check_scene_manifest(info):
    configurations = info.get("UIApplicationSceneManifest", {}).get("UISceneConfigurations", {})
    scenes = configurations.get("UIWindowSceneSessionRoleApplication", [])
    if not any(scene.get("UISceneDelegateClassName") for scene in scenes):
        raise ValueError(
            "Missing iOS scene delegate: enable expo-build-properties ios.enableSceneSupport "
            "and regenerate ios/ before shipping with Xcode 27."
        )


if __name__ == "__main__":
    with open(sys.argv[1], "rb") as source:
        info = plistlib.load(source)
    try:
        check_scene_manifest(info)
    except ValueError as error:
        sys.exit(str(error))
    print("iOS scene manifest verified")
