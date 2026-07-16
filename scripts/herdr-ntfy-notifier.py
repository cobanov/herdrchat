#!/usr/bin/env python3
"""Push a phone notification when a herdr agent gets blocked.

Runs on the herdr host (the machine the agents run on). Polls the local herdr
socket via `herdr api snapshot`, and when any agent transitions into the
`blocked` state it POSTs to an ntfy topic. On the phone, the ntfy app shows the
notification. No Apple Developer account or APNs required.

Usage:
    NTFY_URL=https://ntfy.sh/my-secret-topic ./herdr-ntfy-notifier.py
    # or a homelab ntfy:
    NTFY_URL=https://ntfy.example.ts.net/herdr POLL_SECONDS=3 ./herdr-ntfy-notifier.py

Environment:
    NTFY_URL      Full ntfy topic URL to POST to (required).
    POLL_SECONDS  Poll interval, default 3.
    HERDR_BIN     herdr binary, default "herdr".
"""

import json
import os
import subprocess
import sys
import time
import urllib.request

NTFY_URL = os.environ.get("NTFY_URL")
POLL_SECONDS = float(os.environ.get("POLL_SECONDS", "3"))
HERDR_BIN = os.environ.get("HERDR_BIN", "herdr")


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


def notify(title, message):
    request = urllib.request.Request(
        NTFY_URL,
        data=message.encode("utf-8"),
        headers={"Title": title, "Tags": "raising_hand", "Priority": "high"},
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

    print(f"Watching herdr for blocked agents -> {NTFY_URL} (every {POLL_SECONDS}s)")
    previous = {}  # pane_id -> last status
    while True:
        labels = workspace_labels()
        for agent in snapshot_agents():
            pane = agent.get("pane_id")
            status = agent.get("agent_status")
            was = previous.get(pane)
            if status == "blocked" and was != "blocked":
                label = labels.get(agent.get("workspace_id"), agent.get("workspace_id", "?"))
                name = agent.get("agent", "agent")
                notify(f"{label} seni bekliyor", f"{name} bir yanit bekliyor (blocked).")
            if pane:
                previous[pane] = status
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
