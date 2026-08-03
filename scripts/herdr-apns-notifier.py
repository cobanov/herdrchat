#!/usr/bin/env python3
"""Send an iOS push (APNs) when a herdr agent needs you or finishes.

Runs on the herdr host (the Mac mini the agents run on). Polls the local herdr
socket via `herdr api snapshot`, and when any agent transitions into `blocked`
(waiting for your input) or `done` (finished), it sends an APNs push straight to
the phone — so HerdrChat notifies you even when it's closed or backgrounded.
This is the iOS counterpart to Android's foreground watch service.

Dependency-free: signs the APNs JWT with `openssl` (ES256) and delivers over
HTTP/2 with `curl`. No pip installs.

Device tokens: the HerdrChat app writes its APNs token to
~/.config/herdrchat/apns-tokens/<id>.json on connect; this watcher pushes to
every token it finds there.

Config (env, or ~/.config/herdrchat/apns.env as KEY=VALUE lines):
    APNS_KEY_ID     10-char Key ID of your APNs auth key (required).
    APNS_TEAM_ID    Apple Team ID (required).
    APNS_KEY_PATH   Path to the AuthKey_XXXX.p8 (default: first .p8 under
                    ~/.config/herdrchat/ or ~/.appstoreconnect/private_keys/).
    APNS_BUNDLE_ID  App bundle id / apns-topic (default dev.herdr.HerdrChat).
    APNS_ENV        "production" (default, TestFlight/App Store) or "sandbox".
    NOTIFY_ON       States to notify on (default "blocked,done").
    POLL_SECONDS    Poll interval (default 3).
    HERDR_BIN       herdr binary (default: herdr).
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

HOME = os.path.expanduser("~")
CONFIG_DIR = os.path.join(HOME, ".config", "herdrchat")
TOKENS_DIR = os.path.join(CONFIG_DIR, "apns-tokens")


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


def _find_key_path():
    for base in (CONFIG_DIR, os.path.join(HOME, ".appstoreconnect", "private_keys")):
        hits = sorted(glob.glob(os.path.join(base, "AuthKey_*.p8"))) or sorted(glob.glob(os.path.join(base, "*.p8")))
        if hits:
            return hits[0]
    return None


_load_env_file()
KEY_ID = os.environ.get("APNS_KEY_ID")
TEAM_ID = os.environ.get("APNS_TEAM_ID", "")
KEY_PATH = os.environ.get("APNS_KEY_PATH") or _find_key_path()
BUNDLE_ID = os.environ.get("APNS_BUNDLE_ID", "dev.herdr.HerdrChat")
APNS_HOST = "api.sandbox.push.apple.com" if os.environ.get("APNS_ENV") == "sandbox" else "api.push.apple.com"
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


def device_tokens():
    """All registered APNs device tokens (hex strings)."""
    out = []
    for path in glob.glob(os.path.join(TOKENS_DIR, "*.json")):
        try:
            tok = json.load(open(path)).get("token")
            if tok:
                out.append(tok)
        except (OSError, ValueError):
            continue
    return out


def send_push(device_token: str, title: str, body: str) -> bool:
    payload = json.dumps({"aps": {"alert": {"title": title, "body": body}, "sound": "default"}})
    result = subprocess.run(
        [
            "curl", "--http2", "-s", "-o", "/dev/null", "-w", "%{http_code}",
            "-X", "POST",
            "-H", f"authorization: bearer {apns_jwt()}",
            "-H", f"apns-topic: {BUNDLE_ID}",
            "-H", "apns-push-type: alert",
            "-H", "apns-priority: 10",
            "-d", payload,
            f"https://{APNS_HOST}/3/device/{device_token}",
        ],
        capture_output=True, text=True,
    )
    code = result.stdout.strip()
    if code != "200":
        print(f"[apns] push failed ({code}) for token …{device_token[-6:]}", file=sys.stderr)
    return code == "200"


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


def main():
    if not KEY_ID or not KEY_PATH or not os.path.exists(KEY_PATH or ""):
        sys.exit("APNS_KEY_ID and a readable APNS_KEY_PATH (.p8) are required — see script header.")
    os.makedirs(TOKENS_DIR, exist_ok=True)
    print(f"[apns] watching herdr; key {KEY_ID}, topic {BUNDLE_ID}, host {APNS_HOST}", file=sys.stderr)
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
                if seeded and last.get(pane) != status and status in NOTIFY_ON and status in STYLES:
                    label = labels.get(a.get("workspace_id"), a.get("workspace_id", "agent"))
                    name = a.get("agent") or "agent"
                    title, body = (t.format(label=label, name=name) for t in STYLES[status])
                    for tok in tokens:
                        send_push(tok, title, body)
                last[pane] = status
            seeded = True
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
