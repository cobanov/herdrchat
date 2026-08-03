# App Store / TestFlight metadata checklist

Run through this before submitting for Beta App Review (public link) or App Store review.

## App Review Information (App Store Connect)
- [ ] Demo host address + `appreview` username + SSH key/password pasted in the review fields
      (see `reviewer-setup.md`). Confirmed working from a clean device.
- [ ] Notes = the "What the app is / How to test / Payments / Data" section of `review-notes.md`.
- [ ] Contact: Mert Cobanov, mertcobanov@gmail.com, **phone still needed** — Beta App Review
      requires one and it is not recorded anywhere in this repo.
- [ ] Export compliance: non-exempt encryption = No (matches `ITSAppUsesNonExemptEncryption=NO`).

## Privacy
- [x] **Privacy policy URL: `https://herdrchat.cobanov.dev/privacy`** — required for a public
      TestFlight link. Source is `site/privacy/index.html` in this repo.
- [x] `PrivacyInfo.xcprivacy` present and honest — verified in `ios/HerdrChat/`:
      `NSPrivacyTracking=false` and `NSPrivacyCollectedDataTypes` is an empty array, which is
      what lets the ASC nutrition label say "Data Not Collected" truthfully.
- [ ] Privacy "Nutrition Label" in ASC = Data Not Collected (connection info + keys stay on-device
      in the Keychain; nothing leaves except SSH to the user's own host).
- [ ] Account deletion path documented (no account → covered; state it explicitly).

## Metadata
- [ ] Name / subtitle / description make clear it's a client for **your own** machine (avoids the
      "remote control / requires hardware we don't disclose" rejection).
- [ ] Keywords, support URL, marketing URL — both URLs are
      `https://herdrchat.cobanov.dev` (privacy policy at `/privacy`).
- [ ] Usage strings tight and feature-specific: `NSLocalNetworkUsageDescription` (Tailscale reach),
      and only the ones actually used. No stale permission strings.

## Screenshots (per required device sizes)
- [ ] 01 — chat list (workspaces with presence).
- [ ] 02 — a chat thread (agent bubbles, a tool-call chip, the composer).
- [ ] 03 — a blocked prompt with labelled choices.
- [ ] (optional) 04 — a notification.
- [ ] Captured on a clean build with the demo data; status bar tidy.

## Public TestFlight link (external)
- [ ] External group "Public Beta" exists (`swift scripts/asc.swift <issuer> public-link`).
- [ ] A build assigned to it and submitted for Beta App Review (one-time per version, ~1–2 days).
- [ ] "What to Test" notes set. Link (https://testflight.apple.com/join/zTmVfpkn) goes in the README
      only after the first external build is approved.
