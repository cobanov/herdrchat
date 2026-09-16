import unittest

from check_ios_scene import check_scene_manifest


class SceneManifestTests(unittest.TestCase):
    def test_requires_an_application_scene_delegate(self):
        for info in (
            {},
            {"UIApplicationSceneManifest": {}},
            {"UIApplicationSceneManifest": {"UISceneConfigurations": {
                "UIWindowSceneSessionRoleApplication": [{"UISceneConfigurationName": "Default"}],
            }}},
            {"UIApplicationSceneManifest": {"UISceneConfigurations": {
                "UIWindowSceneSessionRoleExternalDisplay": [{"UISceneDelegateClassName": "External"}],
            }}},
        ):
            with self.subTest(info=info), self.assertRaises(ValueError):
                check_scene_manifest(info)

    def test_accepts_expo_scene_delegate(self):
        check_scene_manifest({"UIApplicationSceneManifest": {"UISceneConfigurations": {
            "UIWindowSceneSessionRoleApplication": [{"UISceneDelegateClassName": "EXExpoAppSceneDelegate"}],
        }}})


if __name__ == "__main__":
    unittest.main()
