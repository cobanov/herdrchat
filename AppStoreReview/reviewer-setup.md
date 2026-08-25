# What a reviewer needs from us

**Nothing.** That is the point of this file, and it is the second answer to the
question — the first one was wrong and is kept below, because the reasoning is
worth more than the conclusion.

The app is a client for a machine you administer. A reviewer administers no such
machine, so for a year the plan was to lend them one: a throwaway VM, a
review-only Unix account, SSH exposed to the public internet for the review
window, a private key pasted into App Store Connect, and a teardown afterwards
that somebody has to remember to do.

That plan is now in git history rather than in this file, because every part of
it was a liability:

- A private key in a metadata field is a private key in a metadata field.
- Public SSH for "the review window" is public SSH until someone closes it.
- It has to be rebuilt from scratch for **every** submission, and it rots
  silently between them.
- It tests a host, not the app. If the VM is unreachable the reviewer sees a
  connection error and rejects the binary for it.

## What replaced it

A demo host compiled into the app. `HerdrTransport` has two methods, so a
fictional host substitutes for a real one underneath the entire stack — the chat
list, the transcript reader, the byte cursor, the blocked-prompt bar and the live
tail all run their real code against it. See `src/lib/demo/` and the tests in
`src/lib/__tests__/demoHost.test.ts`, which drive it through the same
`HerdrClient` the app uses.

With no hosts configured, first launch selects it. So the reviewer's setup is:
install, open. There is no account, no credential and no host, which is why
`demoAccountRequired` is false.

## The one thing to check before submitting

That the build attached to the version actually contains the demo. Build 51 went
to review with review notes describing a demo it did not have — the notes were
written for the following build. The reviewer followed step (a), saw an empty
Chats tab, and there was no way for them to tell whether the app or the
instructions were broken.

The demo landed in **build 52**. Anything at or above that is fine; anything
below it must not be submitted with these notes.
