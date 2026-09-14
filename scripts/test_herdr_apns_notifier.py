import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import patch


def load_notifier():
    spec = importlib.util.spec_from_file_location(
        "herdr_apns_notifier", Path(__file__).with_name("herdr-apns-notifier.py")
    )
    module = importlib.util.module_from_spec(spec)
    with patch.dict(os.environ, {}, clear=True), patch("os.path.exists", return_value=False):
        spec.loader.exec_module(module)
    return module


class ApnsConfigTests(unittest.TestCase):
    def test_never_guesses_a_provider_key(self):
        with patch("glob.glob", return_value=["/keys/AuthKey_unrelated.p8"]) as search:
            notifier = load_notifier()
        self.assertIsNone(notifier.KEY_PATH)
        search.assert_not_called()

    def test_missing_field_stops_before_starting_the_watcher(self):
        notifier = load_notifier()
        for field in ("KEY_ID", "TEAM_ID", "KEY_PATH"):
            with self.subTest(field=field), patch.multiple(
                notifier, KEY_ID="test-key", TEAM_ID="test-team", KEY_PATH=__file__
            ), patch.object(notifier, field, None), patch.object(notifier.os, "makedirs") as mkdir:
                with self.assertRaisesRegex(SystemExit, "APNS_KEY_ID, APNS_TEAM_ID.*APNS_KEY_PATH"):
                    notifier.main()
                mkdir.assert_not_called()

    def test_key_must_be_a_readable_file(self):
        notifier = load_notifier()
        for is_file, readable in ((False, True), (True, False)):
            with self.subTest(is_file=is_file, readable=readable), patch.multiple(
                notifier, KEY_ID="test-key", TEAM_ID="test-team", KEY_PATH="/keys/push.p8"
            ), patch("os.path.isfile", return_value=is_file), patch("os.access", return_value=readable):
                with self.assertRaisesRegex(SystemExit, "readable APNS_KEY_PATH"):
                    notifier.main()


if __name__ == "__main__":
    unittest.main()
