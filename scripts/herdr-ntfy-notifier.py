#!/usr/bin/env python3
"""Push a phone notification when a herdr agent needs you or finishes.

Runs on the herdr host (the machine the agents run on). Polls the local herdr
socket via `herdr api snapshot`, and when any agent transitions into a state of
interest (`blocked`: waiting for your input, `done`: finished its work) it POSTs
to an ntfy topic. On the phone, the ntfy app shows the notification — even with
HerdrChat closed. No Apple Developer account or APNs required.

Usage:
    NTFY_URL=https://ntfy.sh/my-secret-topic ./herdr-ntfy-notifier.py
    # or a homelab ntfy with auth:
    NTFY_URL=https://ntfy.example.com/herdr NTFY_TOKEN=tk_xxx ./herdr-ntfy-notifier.py

Environment:
    NTFY_URL      Full ntfy topic URL to POST to (required).
    NTFY_TOKEN    Bearer token for an auth-protected ntfy server (optional).
                  If unset, falls back to the macOS Keychain item with service
                  "herdrchat-ntfy" — so a LaunchAgent plist never has to hold
                  the credential in plaintext.
    NOTIFY_ON     Comma-separated states to notify on (default "blocked,done").
    POLL_SECONDS  Poll interval, default 3.
    HERDR_BIN     herdr binary, default "herdr".
"""

import json
import os
import subprocess
import sys
import time
import urllib.request


def _keychain_token():
    """macOS Keychain fallback for the ntfy token (service: herdrchat-ntfy)."""
    try:
        out = subprocess.run(
            ["security", "find-generic-password", "-s", "herdrchat-ntfy", "-w"],
            capture_output=True, text=True, timeout=10,
        )
        return out.stdout.strip() or None if out.returncode == 0 else None
    except (subprocess.SubprocessError, FileNotFoundError):
        return None


NTFY_URL = os.environ.get("NTFY_URL")
NTFY_TOKEN = os.environ.get("NTFY_TOKEN") or _keychain_token()
NOTIFY_ON = {s.strip() for s in os.environ.get("NOTIFY_ON", "blocked,done").split(",") if s.strip()}
POLL_SECONDS = float(os.environ.get("POLL_SECONDS", "3"))
HERDR_BIN = os.environ.get("HERDR_BIN", "herdr")

# Per-state notification style: (title template, body template, tags, priority)
STYLES = {
    "blocked": ("{label} seni bekliyor", "{name} bir yanıt bekliyor.", "raising_hand", "high"),
    "done": ("{label} bitti", "{name} işini tamamladı.", "white_check_mark", "default"),
}


def snapshot_agents():
    """Return the list of agent dicts from `herdr api snapshot`, or [] on error."""
    try:
        out = subprocess.run(
            [HERDR_BIN, "api", "snapshot"],
            capture_output=True, text=True, timeout=15,
        )
        if out.returncode != 0:
            return []
        data = json.loads(out.stdout)
        return data.get("result", {}).get("snapshot", {}).get("agents", [])
    except (subprocess.SubprocessError, json.JSONDecodeError):
        return []


def workspace_labels():
    """Map workspace_id -> label from `herdr workspace list`."""
    try:
        out = subprocess.run(
            [HERDR_BIN, "workspace", "list"],
            capture_output=True, text=True, timeout=15,
        )
        workspaces = json.loads(out.stdout).get("result", {}).get("workspaces", [])
        return {w["workspace_id"]: w.get("label", w["workspace_id"]) for w in workspaces}
    except (subprocess.SubprocessError, json.JSONDecodeError, KeyError):
        return {}


def notify(state, label, name):
    # ntfy's JSON publish format: unicode-safe titles (HTTP headers are latin-1
    # only, which would mangle Turkish characters). POST goes to the server
    # BASE url with the topic in the body.
    base, _, topic = NTFY_URL.rpartition("/")
    title_tpl, body_tpl, tags, priority = STYLES.get(
        state, ("{label}: {name}", "{name} -> " + state, "bell", "default")
    )
    payload = {
        "topic": topic,
        "title": title_tpl.format(label=label, name=name),
        "message": body_tpl.format(label=label, name=name),
        "tags": [tags],
        "priority": {"high": 4, "default": 3}.get(priority, 3),
    }
    # Custom UA: Cloudflare's bot rules 403 the default Python-urllib agent.
    headers = {"Content-Type": "application/json", "User-Agent": "herdrchat-notifier/1.0"}
    if NTFY_TOKEN:
        headers["Authorization"] = f"Bearer {NTFY_TOKEN}"
    request = urllib.request.Request(
        base,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        urllib.request.urlopen(request, timeout=10)
    except OSError as error:
        print(f"ntfy POST failed: {error}", file=sys.stderr)


def main():
    if not NTFY_URL:
        print("Set NTFY_URL to your ntfy topic URL.", file=sys.stderr)
        sys.exit(2)

    print(f"Watching herdr for {sorted(NOTIFY_ON)} -> {NTFY_URL} (every {POLL_SECONDS}s)")
    previous = {}   # pane_id -> last status
    first_pass = True   # seed silently: don't fire for states that predate us
    while True:
        labels = workspace_labels()
        for agent in snapshot_agents():
            pane = agent.get("pane_id")
            status = agent.get("agent_status")
            was = previous.get(pane)
            if not first_pass and status in NOTIFY_ON and was != status:
                label = labels.get(agent.get("workspace_id"), agent.get("workspace_id", "?"))
                name = agent.get("agent", "agent")
                notify(status, label, name)
            if pane:
                previous[pane] = status
        first_pass = False
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
