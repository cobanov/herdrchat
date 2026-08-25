# HerdrChat — App Review notes

The **Review notes** section below is the source for App Store Connect → the
version → App Review Information → Notes. It is kept here so that a change to
what the app does and a change to what we tell Apple it does land in the same
diff — the same reason `site/privacy/index.html` lives in this repo.

If you edit this file, push the change to App Store Connect too. The two drifting
apart is not hypothetical: it is what happened to build 51.

`demoAccountRequired` is **false** and both demo-account fields are empty. There
is no account, and no credential of any kind is needed to review the app — see
[reviewer-setup.md](reviewer-setup.md).

---

## Review notes (verbatim)

NO LOGIN, NO ACCOUNT, NO PURCHASE. The app opens straight into a usable state.

**2. DEVICES AND OS TESTED**

iPhone 17 Pro, iOS 26.5 — physical device, installed via TestFlight, against a real host.
iPhone 17 Pro and iPhone 17 Pro Max simulators, iOS 26.5.
Deployment target is iOS 17.0. Liquid Glass surfaces need iOS 26 and fall back to a solid surface below that.

**3. WHAT THE APP DOES AND WHO IT IS FOR**

For developers who run AI coding agents (Claude Code) on a computer they own. Those agents run on a desktop machine; checking on one means opening a laptop, or connecting from a phone to a terminal interface never designed for a small screen and a soft keyboard. HerdrChat turns each herdr workspace on that machine into a chat: clean message bubbles instead of raw terminal output, and a waiting agent's question rendered as labelled buttons so it can be answered in two taps.

**4. HOW TO SET UP AND REACH THE MAIN FEATURES**

No credentials are needed to review it. On first launch, with no hosts configured, the app selects a built-in DEMO HOST and opens on a working sample conversation. Nothing is transmitted anywhere in this mode.

  a. Launch the app. The Chats tab lists three sample workspaces (herdrchat, notes, scratch). The selected host reads "Demo" under the title.
  b. Open "herdrchat". A conversation appears, and at the bottom a question from the agent with two numbered options.
  c. Tap "1. Yes, go ahead". The options clear and a reply follows.
  d. Open "notes", type anything in the composer and send. The message appears and a reply follows.
  e. The Hosts tab shows the demo, labelled "A sample conversation. No machine, no SSH, nothing sent."

For real use the user adds their own host: a computer they administer running herdr and Claude Code, reachable over SSH. That path needs credentials for a machine the reviewer does not have, which is exactly why the demo exists.

**5. EXTERNAL SERVICES USED FOR CORE FUNCTIONALITY**

None that we operate, and no third-party SDKs. Specifically:

  - No back end. We run no server; there is no system of ours the app talks to.
  - No analytics, advertising, tracking or crash-reporting SDKs.
  - No authentication service, no data provider, no payment processor.
  - NO AI SERVICE IS CALLED BY THE APP. The app does not send prompts to any model API. The AI agent (Claude Code) runs on the user's own computer, started by the user; the app reads that agent's transcript files over SSH and sends keystrokes to it. The intelligence is on the user's machine, not behind an API key of ours.
  - The only network connection is SSH, to an address the user types in, normally over their own Tailscale network.
  - Optional notifications are sent by a script running on the user's own machine, signed with the user's own Apple push key, direct to APNs. Nothing of ours is in that path.
  - herdr (https://herdr.dev) is the open-source tool this app is a client for. The user installs and runs it themselves on their own computer.

**6. REGIONAL DIFFERENCES**

None. The app behaves identically in every region, has no geo-gated content or features, and ships a single English interface.

**7. REGULATED INDUSTRY OR PROTECTED THIRD-PARTY MATERIAL**

Neither. The app is not in a regulated industry and includes no protected third-party material. It is our own code, published as open source under Apache-2.0 at https://github.com/cobanov/herdrchat, where every claim above can be checked against the source.

---

## Answers we keep ready but do not paste

These come up in review correspondence rather than in the notes field.

**Not remote-control malware.** It runs the user's own agent tooling on the
user's own machine, with the user's own credentials, over an SSH session the user
configured. Host keys are pinned on first use and a changed key is refused rather
than warned about.

**Payments.** None. No in-app purchases, no external purchase links, no
subscriptions. The app is free; herdr and Claude are the user's own separately
obtained tools.

**Account deletion, Guideline 5.1.1(v).** There is no account. SSH secrets and
host-key pins live in the device Keychain; the host list, cached bubbles and
preferences live in a local SQLite database. Removing a host deletes its Keychain
entries, *Settings → Clear cached messages* clears the conversation cache, and
deleting the app removes everything. No server-side data exists to delete,
because we run no server.

**Privacy policy.** https://herdrchat.cobanov.dev/privacy — source in
`site/privacy/index.html`, so the published page and the behaviour it describes
are reviewed together.

**Encryption.** Standard SSH only, exempt. `ITSAppUsesNonExemptEncryption = NO`
in the Info.plist.
