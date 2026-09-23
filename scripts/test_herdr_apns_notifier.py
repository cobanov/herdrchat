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


class RoutingPayloadTests(unittest.TestCase):
    """#91: a push names the phone's connection for this host and the session."""

    def run_one_change(self, notifier, token_files):
        seen = []
        agents = [
            [{"pane_id": "w1:p1", "workspace_id": "w1", "agent": "claude", "agent_status": "working",
              "agent_session": {"kind": "id", "value": "sess-1"}}],
            [{"pane_id": "w1:p1", "workspace_id": "w1", "agent": "claude", "agent_status": "blocked",
              "agent_session": {"kind": "id", "value": "sess-1"}}],
        ]

        def snapshots():
            if not agents:
                raise KeyboardInterrupt
            return agents.pop(0)

        with patch.multiple(notifier, KEY_ID="k", TEAM_ID="t", KEY_PATH=__file__), \
                patch("os.path.isfile", return_value=True), patch("os.access", return_value=True), \
                patch.object(notifier.os, "makedirs"), \
                patch.object(notifier, "snapshot_agents", side_effect=snapshots), \
                patch.object(notifier, "workspace_labels", return_value={"w1": "api"}), \
                patch.object(notifier, "device_tokens", return_value=token_files), \
                patch.object(notifier, "send_push", side_effect=lambda tok, t, b, extra=None: seen.append((tok, extra))), \
                patch.object(notifier.time, "sleep"):
            with self.assertRaises(KeyboardInterrupt):
                notifier.main()
        return seen

    def test_each_device_gets_its_own_connection_and_the_session(self):
        notifier = load_notifier()
        seen = self.run_one_change(notifier, [("tok-a", "conn-a"), ("tok-b", None)])
        self.assertEqual(seen, [
            ("tok-a", {"workspace": "w1", "label": "api", "session": "sess-1", "connection": "conn-a"}),
            ("tok-b", {"workspace": "w1", "label": "api", "session": "sess-1"}),
        ])


if __name__ == "__main__":
    unittest.main()
