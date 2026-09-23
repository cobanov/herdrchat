#!/usr/bin/env python3
"""Send an iOS push when a herdr agent needs you or finishes.

Runs on the herdr host (the machine the agents run on). Polls herdr with
`herdr api snapshot`, and when an agent becomes `blocked` (waiting for your
input) or `done` (finished), it sends a push to every phone registered here,
so HerdrChat notifies you even when it is closed.

Two ways to reach Apple:

- Through the HerdrChat relay (the default, and the only way for the App Store
  build). Apple only accepts a push signed by the team that built the app, so
  the relay holds that key. It receives the device token and the notification
  text, signs, forwards, and keeps nothing. Source: relay/ in the repository.
- Straight to APNs, when you build and sign the app yourself: set all three of
  APNS_KEY_ID, APNS_TEAM_ID and APNS_KEY_PATH to your own APNs key.

Dependency-free: python3 and, in direct mode, `openssl` and `curl`.

Device tokens: the HerdrChat app writes its token to
~/.config/herdrchat/apns-tokens/<id>.json over SSH (under sessions/<name>/
for a named herdr session); this watcher pushes to every token it finds there.
A token Apple reports as retired is deleted.

Config (env, or ~/.config/herdrchat/apns.env as KEY=VALUE lines):
    HERDRCHAT_RELAY_URL  Relay endpoint (default the HerdrChat relay).
    APNS_KEY_ID     Direct mode: 10-char Key ID of your APNs auth key.
    APNS_TEAM_ID    Direct mode: your Apple Team ID.
    APNS_KEY_PATH   Direct mode: path to your AuthKey_XXXX.p8.
                    App Store Connect API keys cannot be used for APNs.
    APNS_BUNDLE_ID  Direct mode: bundle id / apns-topic (default dev.herdr.HerdrChat).
    APNS_ENV        Direct mode: force "production" or "sandbox"; by default
                    each token's own environment is used.
    NOTIFY_ON       States to notify on (default "blocked,done").
    POLL_SECONDS    Poll interval (default 3).
    HERDR_BIN       herdr binary (default: herdr).
    HERDR_SESSION   The herdr session to watch (default: herdr's default).
"""

import base64
import glob
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

# Bumped with every change the app should roll out: the app embeds this script,
# installs it on a host, and offers an update when a host runs an older one.
WATCHER_VERSION = 2

HOME = os.path.expanduser("~")
CONFIG_DIR = os.path.join(HOME, ".config", "herdrchat")


def _load_env_file():
    """Merge ~/.config/herdrchat/apns.env into os.environ (env wins)."""
    path = os.path.join(CONFIG_DIR, "apns.env")
    if not os.path.exists(path):
        return
    for line in open(path):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"'))


_load_env_file()
KEY_ID = os.environ.get("APNS_KEY_ID")
TEAM_ID = os.environ.get("APNS_TEAM_ID", "")
KEY_PATH = os.environ.get("APNS_KEY_PATH")
BUNDLE_ID = os.environ.get("APNS_BUNDLE_ID", "dev.herdr.HerdrChat")
FORCED_ENV = os.environ.get("APNS_ENV")
RELAY_URL = os.environ.get("HERDRCHAT_RELAY_URL", "https://push.herdrchat.cobanov.dev/v1/push")
SESSION = os.environ.get("HERDR_SESSION", "").strip()
# A named session's phones register under their own folder: a push names a
# workspace, and workspace ids mean something only within one session.
TOKENS_DIR = os.path.join(
    CONFIG_DIR, "apns-tokens", *(["sessions", SESSION] if SESSION and SESSION != "default" else [])
)
# Apple's answers that mean this token will never work again.
RETIRED = {"Unregistered", "BadDeviceToken", "DeviceTokenNotForTopic"}
NOTIFY_ON = {s.strip() for s in os.environ.get("NOTIFY_ON", "blocked,done").split(",") if s.strip()}
POLL_SECONDS = float(os.environ.get("POLL_SECONDS", "3"))
HERDR_BIN = os.environ.get("HERDR_BIN", "herdr")

STYLES = {
    "blocked": ("{label} is waiting for you", "{name} is waiting for a reply."),
    "done": ("{label} is done", "{name} finished its task."),
}


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _der_to_raw(der: bytes) -> bytes:
    """Convert an ECDSA DER signature (SEQUENCE{INTEGER r, INTEGER s}) to the
    raw 64-byte r||s that JWS ES256 requires."""
    assert der[0] == 0x30
    i = 2 if der[1] < 0x80 else 3
    assert der[i] == 0x02
    rlen = der[i + 1]
    r = der[i + 2 : i + 2 + rlen]
    j = i + 2 + rlen
    assert der[j] == 0x02
    slen = der[j + 1]
    s = der[j + 2 : j + 2 + slen]
    r = r.lstrip(b"\x00").rjust(32, b"\x00")
    s = s.lstrip(b"\x00").rjust(32, b"\x00")
    return r + s


_jwt_cache = {"token": None, "iat": 0}


def apns_jwt() -> str:
    """A cached ES256 provider token (APNs accepts tokens 20–60 min old)."""
    now = int(time.time())
    if _jwt_cache["token"] and now - _jwt_cache["iat"] < 1500:
        return _jwt_cache["token"]
    header = _b64url(json.dumps({"alg": "ES256", "kid": KEY_ID, "typ": "JWT"}).encode())
    payload = _b64url(json.dumps({"iss": TEAM_ID, "iat": now}).encode())
    signing_input = f"{header}.{payload}".encode()
    der = subprocess.run(
        ["openssl", "dgst", "-sha256", "-sign", KEY_PATH, "-binary"],
        input=signing_input, capture_output=True, check=True,
    ).stdout
    token = f"{header}.{payload}.{_b64url(_der_to_raw(der))}"
    _jwt_cache.update(token=token, iat=now)
    return token


def mode():
    """"direct" with a complete APNs key, "relay" with none of it, else the
    names of what is missing, because half a key is a mistake worth stopping on."""
    given = {"APNS_KEY_ID": KEY_ID, "APNS_TEAM_ID": TEAM_ID, "APNS_KEY_PATH": KEY_PATH}
    missing = [name for name, value in given.items() if not value]
    if not missing:
        return "direct"
    if len(missing) == len(given):
        return "relay"
    return missing


def device_tokens():
    """Registered devices: (APNs token, the app's connection id for this host,
    the token's APNs environment).

    The connection id is how a tap on the phone knows which of its hosts sent
    the push. Token files from app builds before it have none (None here)."""
    out = []
    for path in glob.glob(os.path.join(TOKENS_DIR, "*.json")):
        try:
            data = json.load(open(path))
            tok = data.get("token")
            if tok:
                env = "sandbox" if data.get("env") in ("sandbox", "development") else "production"
                out.append((tok, data.get("connection"), env))
        except (OSError, ValueError):
            continue
    return out


def forget_token(device_token: str):
    """Delete every file carrying a token Apple has retired."""
    for path in glob.glob(os.path.join(TOKENS_DIR, "*.json")):
        try:
            if json.load(open(path)).get("token") == device_token:
                os.remove(path)
        except (OSError, ValueError):
            continue


def send_push(device_token: str, title: str, body: str, extra=None, env="production"):
    """Deliver one notification. Returns (http status, Apple's reason or None).

    `extra` rides at the payload root beside `aps`. The app reads `workspace`
    (and optional `label`, `session`, `connection`) from it to open the tapped
    thread."""
    if mode() == "direct":
        return _send_direct(device_token, title, body, extra, FORCED_ENV or env)
    return _send_relay(device_token, title, body, extra, env)


def _send_relay(device_token, title, body, extra, env):
    request = urllib.request.Request(
        RELAY_URL,
        data=json.dumps({
            "token": device_token, "env": env,
            "title": title[:120], "body": body[:240], "data": extra or {},
        }).encode(),
        headers={"content-type": "application/json", "user-agent": "herdrchat-notifier"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status, None
    except urllib.error.HTTPError as error:
        try:
            reason = json.loads(error.read() or b"{}").get("reason")
        except ValueError:
            reason = None
        return error.code, reason
    except (urllib.error.URLError, OSError) as error:
        return 0, str(error)


def _send_direct(device_token, title, body, extra, env):
    root = {"aps": {"alert": {"title": title, "body": body}, "sound": "default"}}
    if extra:
        root.update(extra)
    host = "api.sandbox.push.apple.com" if env == "sandbox" else "api.push.apple.com"
    result = subprocess.run(
        [
            "curl", "--http2", "-s", "-o", "-", "-w", "\n%{http_code}",
            "-X", "POST",
            "-H", f"authorization: bearer {apns_jwt()}",
            "-H", f"apns-topic: {BUNDLE_ID}",
            "-H", "apns-push-type: alert",
            "-H", "apns-priority: 10",
            "-d", json.dumps(root),
            f"https://{host}/3/device/{device_token}",
        ],
        capture_output=True, text=True,
    )
    reply, _, code = result.stdout.rpartition("\n")
    try:
        reason = json.loads(reply).get("reason") if reply.strip() else None
    except ValueError:
        reason = None
    return int(code) if code.strip().isdigit() else 0, reason


def snapshot_agents():
    try:
        out = subprocess.run([HERDR_BIN, "api", "snapshot"], capture_output=True, text=True, timeout=15)
        if out.returncode != 0:
            return []
        return json.loads(out.stdout).get("result", {}).get("snapshot", {}).get("agents", [])
    except (subprocess.SubprocessError, ValueError):
        return []


def workspace_labels():
    try:
        out = subprocess.run([HERDR_BIN, "workspace", "list"], capture_output=True, text=True, timeout=15)
        rows = json.loads(out.stdout).get("result", {}).get("workspaces", [])
        return {w["workspace_id"]: w.get("label", w["workspace_id"]) for w in rows}
    except (subprocess.SubprocessError, ValueError, KeyError):
        return {}


def should_notify(agent, previous):
    """Whether this agent's state is news since the last poll, and what to remember.

    `previous` is what the last call returned for the same pane, or None for a
    pane not seen before. Counters are used when herdr sends them, since a
    status compared between polls misses anything that happens in between:

    - completion_seq (herdr #4457) is set only for finished work and moves on
      every completion, so a turn that starts and ends between two polls still
      notifies, and a restore or startup that lands on "done" does not.
    - state_change_seq (herdr 0.9.0) moves on every state change, so an agent
      that answered one prompt and stopped at the next between polls notifies
      again even though it reads "blocked" both times.

    Without either, a change of status is the only signal, as before.
    """
    status = agent.get("agent_status")
    seq = agent.get("state_change_seq")
    completion = agent.get("completion_seq")
    memo = (status, seq, completion)
    last_status, last_seq, last_completion = previous if previous is not None else (None, None, None)
    if status not in NOTIFY_ON or status not in STYLES:
        return False, memo
    if status == "done" and completion is not None:
        return completion != last_completion, memo
    if seq is not None and last_seq is not None:
        return seq != last_seq, memo
    return status != last_status, memo


def main():
    how = mode()
    if isinstance(how, list):
        sys.exit(f"Set all of APNS_KEY_ID, APNS_TEAM_ID and APNS_KEY_PATH for your own APNs key, "
                 f"or none of them to use the HerdrChat relay. Missing: {', '.join(how)}.")
    if how == "direct" and (not os.path.isfile(KEY_PATH) or not os.access(KEY_PATH, os.R_OK)):
        sys.exit("APNS_KEY_PATH must be a readable APNs auth key (.p8). "
                 "App Store Connect API keys are not supported. See the script header.")
    os.makedirs(TOKENS_DIR, exist_ok=True)
    where = f"key {KEY_ID}, topic {BUNDLE_ID}" if how == "direct" else f"relay {RELAY_URL}"
    print(f"[apns] watching herdr{' session ' + SESSION if SESSION else ''}; {where}", file=sys.stderr)
    last = {}
    seeded = False
    while True:
        agents = snapshot_agents()
        if agents:
            labels = workspace_labels()
            tokens = device_tokens()
            for a in agents:
                pane = a.get("pane_id")
                status = a.get("agent_status")
                news, memo = should_notify(a, last.get(pane))
                if seeded and news:
                    label = labels.get(a.get("workspace_id"), a.get("workspace_id", "agent"))
                    name = a.get("agent") or "agent"
                    title, body = (t.format(label=label, name=name) for t in STYLES[status])
                    extra = {"workspace": a.get("workspace_id"), "label": label}
                    session = a.get("agent_session") or {}
                    if session.get("kind") == "id" and session.get("value"):
                        # Lets the app tell this chat from a later one in the
                        # same workspace slot.
                        extra["session"] = session["value"]
                    for tok, connection, env in tokens:
                        status, reason = send_push(
                            tok, title, body, dict(extra, connection=connection) if connection else extra, env=env
                        )
                        if status != 200:
                            print(f"[apns] push failed ({status} {reason or ''}) for token …{tok[-6:]}", file=sys.stderr)
                        if reason in RETIRED:
                            forget_token(tok)
                last[pane] = memo
            seeded = True
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
