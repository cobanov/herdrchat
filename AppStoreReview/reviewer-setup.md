# Preparing the review-only demo host

Internal checklist (for us) to stand up the demo the App Review team uses. Goal: a reviewer with
no Mac and no Tailscale can connect and see a working agent chat in under a minute. Tear it down
after the review.

## 1. A dedicated, throwaway account
- On a small always-on host (a VM or a spare box), create a **review-only** user, e.g. `appreview`.
- Give it **no access** to anything real — its own home, fictional data only.
- Install herdr for that user: `curl -fsSL https://herdr.dev/install.sh | sh` (lands in `~/.local/bin`).

## 2. Reachability for the reviewer (no Tailscale)
Production connects over Tailscale, but a reviewer can't join our tailnet. For the review window,
make the demo host reachable directly:
- A temporary public DNS name / IP with SSH open **only** to the demo account, key-only,
  rate-limited, firewalled to port 22 (or a custom port).
- OR a cloud VM spun up just for review. Either way: **review-only creds, torn down after.**

## 3. Reviewer SSH key
- `ssh-keygen -t ed25519 -f appreview_review -N ''` → add `appreview_review.pub` to the demo
  account's `authorized_keys`.
- Put the **private** key (and the host/username) in App Store Connect → App Review Information.
  Never commit it; never ship it in the app.

## 4. A prepared "App Review" workspace
- In herdr, create a workspace labelled **App Review** in a sample repo (fictional files).
- Start Claude in it so there's a real transcript to show. Seed one exchange so the chat isn't empty.
- Keep it harmless: if you script a canned agent, have it reply to `hi` and offer a simple choice
  (so the reviewer can exercise the blocked-prompt quick replies) and run only `echo app-review-ok`.

## 5. Verify the reviewer path yourself
Install the TestFlight/App Store build on a clean device, add the demo server with the reviewer
key, open **App Review**, send `hi`, confirm a reply + that a notification fires. Screenshot for
the metadata set.

## 6. After review
Disable the `appreview` account, remove the public exposure, rotate/delete the key, and delete the
VM. Note the teardown date in the changelog.
