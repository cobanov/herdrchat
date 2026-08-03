# HerdrChat — App Review Notes

Paste the relevant parts into **App Store Connect → your version → App Review Information → Notes**.
Demo credentials go in the **Sign-In / demo** fields (or Notes) — **never** in the app or in git.

## What the app is
HerdrChat is a **remote client for your own computer**. It connects over **SSH** — on a
private network (Tailscale) in normal use — to a machine you own that runs the open-source
`herdr` tool and Claude Code, and shows your coding-agent sessions as a chat. You type a
message, it's delivered to the agent on your machine; the agent's transcript is streamed back
as chat bubbles.

- **No accounts, no back end.** We run no servers. All traffic is device → the user's own host
  over SSH. There is nothing to sign into on our side.
- **No third-party data collection.** Connection details and the SSH key/password are stored
  only in the device Keychain.
- **Not remote-control malware.** It runs the user's own agent tooling on the user's own
  machine, with the user's own credentials, over an authenticated SSH session the user
  configured. Host keys are pinned on first use (TOFU).

## How to test without owning a Mac
We provide a **review-only demo host**. In App Review Information you'll find:
- **Host / address:** `<demo-host>` (reachable directly for the review window)
- **Username:** `appreview`
- **Auth:** a private key (or password) pasted in the review fields

Steps:
1. Launch HerdrChat → **Add server** → enter the host, username, and paste the key/password →
   **Test connection** → **Save**.
2. Open the **"App Review"** chat. It shows a prepared Claude Code session with fictional data.
3. Type `hi` and send → the demo agent replies within a few seconds. (You can also tap the
   quick-reply chips when it asks a question.)

> Production use is over Tailscale (a private mesh VPN the user installs). For review we expose
> the demo host directly so no VPN setup is needed; it is locked down and torn down after review.

## Notifications
Local notifications fire when an agent needs input or finishes while the app is open. Optional
background push comes from the **user's own host** (APNs), and is **opt-in** — nothing is sent
unless the user enables it.

## Payments
**None.** No in-app purchases, no external purchase links, no subscriptions. The app is free;
`herdr` and Claude are the user's own separately-obtained tools.

## Account deletion & data (Guideline 5.1.1(v))
There is no account. SSH secrets and host-key pins live in the device **Keychain**; the host list,
cached message bubbles and preferences live in a local **SQLite** database on the device. Removing
a server deletes its Keychain entries; *Settings → Clear cached messages* clears the conversation
cache; deleting the app removes everything. No server-side data exists to delete, because we run
no server.

## Privacy policy
`https://herdrchat.cobanov.dev/privacy` — source in `site/privacy/index.html` in this repo, so the
published page and the app's behaviour are reviewed together.

## Encryption
Standard SSH only (exempt). `ITSAppUsesNonExemptEncryption = NO` in the Info.plist.
