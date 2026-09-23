import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import patch


def load_notifier(env=None):
    spec = importlib.util.spec_from_file_location(
        "herdr_apns_notifier", Path(__file__).with_name("herdr-apns-notifier.py")
    )
    module = importlib.util.module_from_spec(spec)
    with patch.dict(os.environ, env or {}, clear=True), patch("os.path.exists", return_value=False):
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
                with self.assertRaisesRegex(SystemExit, "APNS_KEY_ID, APNS_TEAM_ID and APNS_KEY_PATH.*Missing"):
                    notifier.main()
                mkdir.assert_not_called()

    # #95: with no key of their own, App Store users go through the relay.
    def test_no_key_at_all_means_the_relay(self):
        notifier = load_notifier()
        self.assertEqual(notifier.mode(), "relay")
        self.assertTrue(notifier.RELAY_URL.startswith("https://"))
        with patch.multiple(notifier, KEY_ID="k", TEAM_ID="t", KEY_PATH="/keys/push.p8"):
            self.assertEqual(notifier.mode(), "direct")

    def test_a_named_session_reads_its_own_tokens(self):
        self.assertTrue(load_notifier().TOKENS_DIR.endswith("apns-tokens"))
        self.assertTrue(load_notifier({"HERDR_SESSION": "work"}).TOKENS_DIR.endswith("apns-tokens/sessions/work"))
        self.assertTrue(load_notifier({"HERDR_SESSION": "default"}).TOKENS_DIR.endswith("apns-tokens"))

    def test_key_must_be_a_readable_file(self):
        notifier = load_notifier()
        for is_file, readable in ((False, True), (True, False)):
            with self.subTest(is_file=is_file, readable=readable), patch.multiple(
                notifier, KEY_ID="test-key", TEAM_ID="test-team", KEY_PATH="/keys/push.p8"
            ), patch("os.path.isfile", return_value=is_file), patch("os.access", return_value=readable):
                with self.assertRaisesRegex(SystemExit, "readable APNs auth key"):
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
                patch.object(notifier, "send_push",
                             side_effect=lambda tok, t, b, extra=None, env="production": seen.append((tok, extra, env)) or (200, None)), \
                patch.object(notifier.time, "sleep"):
            with self.assertRaises(KeyboardInterrupt):
                notifier.main()
        return seen

    def test_each_device_gets_its_own_connection_and_the_session(self):
        notifier = load_notifier()
        seen = self.run_one_change(notifier, [("tok-a", "conn-a", "production"), ("tok-b", None, "sandbox")])
        self.assertEqual(seen, [
            ("tok-a", {"workspace": "w1", "label": "api", "session": "sess-1", "connection": "conn-a"}, "production"),
            ("tok-b", {"workspace": "w1", "label": "api", "session": "sess-1"}, "sandbox"),
        ])


class RelayTests(unittest.TestCase):
    """#95: what the relay receives, and what the watcher does with its answer."""

    def test_sends_only_the_fields_the_relay_accepts(self):
        notifier = load_notifier()
        sent = {}

        class Reply:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): return False

        def urlopen(request, timeout):
            sent["url"] = request.full_url
            sent["body"] = json.loads(request.data)
            return Reply()

        with patch.object(notifier.urllib.request, "urlopen", side_effect=urlopen):
            result = notifier.send_push("ab" * 32, "api is waiting for you", "claude is waiting for a reply.",
                                        {"workspace": "w1", "connection": "c"}, env="sandbox")
        self.assertEqual(result, (200, None))
        self.assertEqual(sent["url"], notifier.RELAY_URL)
        self.assertEqual(sent["body"], {
            "token": "ab" * 32, "env": "sandbox", "title": "api is waiting for you",
            "body": "claude is waiting for a reply.", "data": {"workspace": "w1", "connection": "c"},
        })

    def test_reads_apples_reason_from_a_refusal(self):
        notifier = load_notifier()
        error = urllib.error.HTTPError(notifier.RELAY_URL, 410, "Gone", {}, io.BytesIO(b'{"reason":"Unregistered"}'))
        with patch.object(notifier.urllib.request, "urlopen", side_effect=error):
            self.assertEqual(notifier.send_push("ab" * 32, "t", "b"), (410, "Unregistered"))

    def test_forgets_a_retired_token_and_keeps_the_rest(self):
        with tempfile.TemporaryDirectory() as folder:
            notifier = load_notifier()
            notifier.TOKENS_DIR = folder
            for name, token in (("a", "dead"), ("b", "alive"), ("c", "dead")):
                Path(folder, f"{name}.json").write_text(json.dumps({"token": token, "env": "production"}))
            notifier.forget_token("dead")
            self.assertEqual(sorted(os.listdir(folder)), ["b.json"])
            self.assertEqual(notifier.device_tokens(), [("alive", None, "production")])



class TransitionTests(unittest.TestCase):
    """#115: herdr's counters catch what two status reads miss."""

    def agent(self, status, seq=None, completion=None):
        a = {"pane_id": "w1:p1", "agent_status": status}
        if seq is not None:
            a["state_change_seq"] = seq
        if completion is not None:
            a["completion_seq"] = completion
        return a

    def sequence(self, notifier, *agents):
        fired, memo = [], None
        for a in agents:
            news, memo = notifier.should_notify(a, memo)
            fired.append(news)
        return fired

    def test_a_whole_turn_between_polls_still_notifies(self):
        notifier = load_notifier()
        # done -> working -> done happened between the second and third poll.
        fired = self.sequence(notifier, self.agent("idle", 3), self.agent("done", 5, 5), self.agent("done", 7, 7))
        self.assertEqual(fired, [False, True, True])

    def test_done_without_a_completion_is_not_news_twice(self):
        notifier = load_notifier()
        fired = self.sequence(notifier, self.agent("done", 5, 5), self.agent("done", 5, 5))
        self.assertEqual(fired, [True, False])

    def test_a_second_prompt_between_polls_notifies(self):
        notifier = load_notifier()
        fired = self.sequence(notifier, self.agent("blocked", 8), self.agent("blocked", 10))
        self.assertEqual(fired, [True, True])

    def test_older_herdr_falls_back_to_status_changes(self):
        notifier = load_notifier()
        fired = self.sequence(notifier, self.agent("working"), self.agent("blocked"), self.agent("blocked"))
        self.assertEqual(fired, [False, True, False])

    def test_quiet_states_never_notify(self):
        notifier = load_notifier()
        fired = self.sequence(notifier, self.agent("idle", 1), self.agent("working", 2))
        self.assertEqual(fired, [False, False])


if __name__ == "__main__":
    unittest.main()
