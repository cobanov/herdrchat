#!/usr/bin/env python3
"""Upload an Android App Bundle to a Google Play track.

Dependency-free on purpose: the Play Developer API needs an RS256-signed JWT, and
`openssl` plus the standard library cover it, so this runs on a clean machine
without pip. Same approach as the APNs notifier in this repo.

Usage:
    play-upload.py <aab> --key <service-account.json> [--track internal]

The service account must be granted "Release manager" on this app in the Play
Console; see PlayRelease/README.md.
"""

import argparse
import base64
import json
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

PACKAGE = "dev.herdr.herdrchat"
SCOPE = "https://www.googleapis.com/auth/androidpublisher"
TOKEN_URL = "https://oauth2.googleapis.com/token"
API = "https://androidpublisher.googleapis.com/androidpublisher/v3"
UPLOAD_API = "https://androidpublisher.googleapis.com/upload/androidpublisher/v3"


def die(message: str) -> "None":
    print(f"ERROR: {message}", file=sys.stderr)
    sys.exit(1)


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def access_token(key_path: Path) -> str:
    """Exchange a service-account JSON key for an OAuth2 access token."""
    try:
        key = json.loads(key_path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        die(f"cannot read service-account key {key_path}: {error}")

    for field in ("client_email", "private_key"):
        if not key.get(field):
            die(f"service-account key is missing '{field}' — is this a JSON key?")

    now = int(time.time())
    header = {"alg": "RS256", "typ": "JWT"}
    claims = {
        "iss": key["client_email"],
        "scope": SCOPE,
        "aud": TOKEN_URL,
        "iat": now,
        "exp": now + 3600,
    }
    signing_input = f"{b64url(json.dumps(header).encode())}.{b64url(json.dumps(claims).encode())}"

    # The key goes to openssl down a pipe and the payload on stdin, so the private
    # key never touches disk. (`/dev/stdin` can't carry both.)
    signature = rs256(signing_input.encode(), key["private_key"])
    assertion = f"{signing_input}.{b64url(signature)}"
    body = urllib.parse.urlencode({
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": assertion,
    }).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(TOKEN_URL, data=body)) as response:
            return json.load(response)["access_token"]
    except urllib.error.HTTPError as error:
        die(f"token exchange failed ({error.code}): {error.read().decode()[:400]}")


def rs256(payload: bytes, pem: str) -> bytes:
    """RS256-sign `payload`, feeding the PEM to openssl through an inherited pipe so
    the private key is never written anywhere another process could read it."""
    import os

    read_fd, write_fd = os.pipe()
    try:
        os.write(write_fd, pem.encode())
    finally:
        os.close(write_fd)
    os.set_inheritable(read_fd, True)
    try:
        result = subprocess.run(
            ["openssl", "dgst", "-sha256", "-sign", f"/dev/fd/{read_fd}"],
            input=payload,
            capture_output=True,
            close_fds=False,
        )
    finally:
        os.close(read_fd)
    if result.returncode != 0:
        die(f"openssl could not sign the JWT: {result.stderr.decode().strip()}")
    return result.stdout


def call(method: str, url: str, token: str, *, body=None, content_type=None):
    headers = {"Authorization": f"Bearer {token}"}
    if content_type:
        headers["Content-Type"] = content_type
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request) as response:
            raw = response.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        die(f"{method} {url.split('/v3')[-1]} failed ({error.code}): {error.read().decode()[:500]}")


def assert_is_signed_bundle(aab: Path) -> None:
    """Refuse anything that isn't a SIGNED App Bundle.

    Two failures this catches before a pointless round trip: handing it an APK
    (Play rejects those for new apps), and handing it an unsigned bundle — which is
    exactly what `bundleRelease` produces when the upload key isn't configured, and
    the resulting API error doesn't say so.
    """
    try:
        with zipfile.ZipFile(aab) as bundle:
            names = bundle.namelist()
    except (OSError, zipfile.BadZipFile) as error:
        die(f"{aab} is not a readable App Bundle: {error}")
    if "BundleConfig.pb" not in names:
        die(f"{aab} has no BundleConfig.pb — that looks like an APK, not an App Bundle")
    if not any(name.startswith("META-INF/") and name.endswith((".RSA", ".DSA", ".EC"))
               for name in names):
        die(f"{aab} is NOT signed. Set the HERDRCHAT_STORE_* credentials "
            "(see PlayRelease/README.md) and rebuild.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("aab", type=Path)
    parser.add_argument("--key", type=Path, required=True)
    parser.add_argument("--track", default="internal",
                        help="internal (default), alpha, beta or production")
    args = parser.parse_args()

    if not args.aab.exists():
        die(f"no such bundle: {args.aab}")
    assert_is_signed_bundle(args.aab)

    token = access_token(args.key)
    print("==> Authenticated with the Play Developer API")

    edit = call("POST", f"{API}/applications/{PACKAGE}/edits", token)
    edit_id = edit["id"]
    print(f"==> Opened edit {edit_id}")

    bundle = call(
        "POST",
        f"{UPLOAD_API}/applications/{PACKAGE}/edits/{edit_id}/bundles?uploadType=media",
        token,
        body=args.aab.read_bytes(),
        content_type="application/octet-stream",
    )
    code = bundle["versionCode"]
    print(f"==> Uploaded versionCode {code}")

    call(
        "PUT",
        f"{API}/applications/{PACKAGE}/edits/{edit_id}/tracks/{args.track}",
        token,
        body=json.dumps({
            "track": args.track,
            "releases": [{"versionCodes": [str(code)], "status": "completed"}],
        }).encode(),
        content_type="application/json",
    )
    print(f"==> Assigned to the '{args.track}' track")

    call("POST", f"{API}/applications/{PACKAGE}/edits/{edit_id}:commit", token)
    print(f"==> Committed. versionCode {code} is live on '{args.track}'.")


if __name__ == "__main__":
    main()
