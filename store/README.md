# App Store pictures

`slides.html` draws every store picture; `render.sh` renders them with headless
Chrome at the exact sizes App Store Connect takes (iPhone 6.9" 1320x2868 as
`APP_IPHONE_67`, iPad 13" 2752x2064 as `APP_IPAD_PRO_3GEN_129`) into `out/`.

```bash
store/render.sh             # all slides
store/render.sh iphone 3    # one slide
```

`raw/` holds the app screens inside the frames. They are real screens from the
iPhone 17 Pro Max and iPad Pro 13" simulators, taken on the demo host with its
fixtures temporarily enriched (five chats, a host named `mac-studio`, a chat
with a picture). Those fixture edits are not committed; to retake a screen,
make them again, capture with `xcrun simctl io <udid> screenshot`, and revert.
`raw/pantry-login.png` is a made-up web page used as the sent picture.

The words, the frames and the callouts are HTML. Keep the copy true to the app:
a callout repeats something on the screen, it never shows a feature that is not
there.
