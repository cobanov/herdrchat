# App Store pictures

`slides.html` draws every store picture; `render.sh` renders them with headless
Chrome at the exact sizes App Store Connect takes (iPhone 6.9" 1320x2868 as
`APP_IPHONE_67`, iPad 13" 2752x2064 as `APP_IPAD_PRO_3GEN_129`) into `out/`.

```bash
store/render.sh             # all slides
store/render.sh iphone 3    # one slide
```

`raw/` holds the app screens inside the frames. They are real screens from an
iPhone Pro Max (1320x2868) and an iPad Pro 13" (landscape, 2752x2064)
simulator, taken on the Demo host enriched by `enrich-demo.py` (five chats, a
host named `mac-studio`, a run of tool calls, a chat with a picture):

```bash
python3 store/enrich-demo.py      # never commit what it changes
# copy raw/pantry-login.png to the app's Documents/attachments/
xcrun simctl status_bar <udid> override --time 9:41 ...
xcrun simctl io <udid> screenshot store/raw/<name>.png
git checkout -- src/lib/demo/fixtures.ts src/state/connections.ts
```

`slash.png` is `/model` sent in release-notes with Sonnet under the cursor;
`pinned.png` is release-notes pinned and muted with herdrchat swiped right.
`raw/pantry-login.png` is a made-up web page used as the sent picture. The iPad
simulator runs in English so the status bar reads "Thu Oct 1", not a
translation.

The words, the frames and the callouts are HTML. Keep the copy true to the app:
a callout repeats something on the screen, it never shows a feature that is not
there.
