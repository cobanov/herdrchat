/*
 * The hero scene: Claude works in a terminal on your computer, the same turn
 * shows up on the phone as a chat, it stops to ask a question, you answer on
 * the phone and the terminal carries on.
 *
 * No dependencies. The markup already holds the frame where the question is
 * waiting, so without JS, or under prefers-reduced-motion, that still frame is
 * the whole story. With motion, the loop starts from that same frame (the
 * banner leaves, the answer is tapped) so nothing jumps on first paint, then
 * plays the turn from the top. It only runs while the scene is on screen and
 * the tab is visible, and picks up where it paused.
 */
(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const scene = document.querySelector('.scene');
  if (!scene) return;

  const term = scene.querySelector('[data-term]');
  const phone = scene.querySelector('[data-phone]');
  const screen = scene.querySelector('.iphone-hero .screen');
  const ask = scene.querySelector('[data-ask]');
  const opt = scene.querySelector('[data-opt]');
  const banner = scene.querySelector('[data-banner]');
  const status = scene.querySelector('[data-status]');
  const statusText = scene.querySelector('[data-status-text]');
  const tap = scene.querySelector('[data-tap]');

  const STATUS = {
    working: 'Opus 5 · herdrchat · working',
    waiting: 'Opus 5 · herdrchat · waiting for reply',
    idle: 'Opus 5 · herdrchat · idle',
  };

  const node = (tag, cls, html) => {
    const n = document.createElement(tag);
    n.className = `${cls} enter`;
    n.innerHTML = html;
    return n;
  };

  // Both panes are bottom-anchored like the real thing, so what overflows
  // leaves through the top, where scrollHeight does not count it. The test is
  // whether the first child now starts above the pane's top edge.
  const trim = (box) => {
    const top = box.getBoundingClientRect().top;
    while (box.children.length > 1 && box.firstElementChild.getBoundingClientRect().top < top - 1) {
      box.firstElementChild.remove();
    }
  };

  const push = (box, n) => { box.append(n); trim(box); return n; };

  const line = (cls, html) => push(term, node('p', `tl ${cls}`, html));
  const bubble = (cls, html) => push(phone, node('div', `b ${cls}`, html));
  const tool = (text) => bubble('b-in b-tool', `<span>${text}</span>`);

  let dots = null;
  const typing = () => { dots = push(phone, node('div', 'b b-in typing', '<i></i><i></i><i></i>')); };
  const stopTyping = () => { if (dots) dots.remove(); dots = null; };

  const setStatus = (kind) => {
    status.className = `p-sub ${kind}`;
    statusText.textContent = STATUS[kind];
  };

  const press = () => {
    const s = screen.getBoundingClientRect();
    const o = opt.getBoundingClientRect();
    tap.style.left = `${o.left - s.left - screen.clientLeft + o.width * 0.28}px`;
    tap.style.top = `${o.top - s.top - screen.clientTop + o.height / 2}px`;
    tap.classList.remove('go');
    void tap.offsetWidth; // restart the animation
    tap.classList.add('go');
    opt.classList.add('pressed');
  };

  // The turn before this one, so neither pane starts empty. It goes in
  // without the entrance animation: it is history, not news.
  const seed = () => {
    const quiet = (box, tag, cls, html) => {
      const n = document.createElement(tag);
      n.className = cls;
      n.innerHTML = html;
      box.append(n);
    };
    quiet(term, 'p', 'tl tl-you', 'show the host fingerprint in monospace');
    quiet(term, 'p', 'tl tl-tool', '<b>Update</b>(src/features/servers/HostKeyPanels.tsx)');
    quiet(term, 'p', 'tl tl-out', 'Updated with 4 additions and 1 removal');
    quiet(term, 'p', 'tl tl-say', 'Done. The fingerprint is monospaced and wraps in pairs now.');
    quiet(phone, 'p', 'p-day', 'Today 12:06');
    quiet(phone, 'div', 'b b-out', 'sort the host list by last connection');
    quiet(phone, 'div', 'b b-in', 'The host list sorts by last connection now.');
    quiet(phone, 'div', 'b b-out', 'show the host fingerprint in monospace');
    quiet(phone, 'div', 'b b-in b-tool', '<span>Edit src/features/servers/HostKeyPanels.tsx</span>');
    quiet(phone, 'div', 'b b-in', 'Done. The fingerprint is monospaced and wraps in pairs now.');
  };

  const found = 'Found it. listDirectories appends "; true", so an unreadable path exits 0 and looks exactly like an empty folder.';
  const done = 'Done. Empty and unreadable are separate states now, and the error one has a Retry.';

  // Each step is [delay before it in ms, action, optional marker].
  const script = [
    [0, () => {
      term.replaceChildren();
      phone.replaceChildren();
      seed();
      dots = null;
      ask.hidden = true;
      opt.classList.remove('pressed');
      banner.classList.remove('show');
      setStatus('working');
      scene.classList.remove('fading');
    }],
    [700, () => line('tl-you', 'why does an empty folder look like an error?')],
    [500, () => bubble('b-out', 'why does an empty folder look like an error?')],
    [600, typing],
    [900, () => line('tl-tool', '<b>Read</b>(src/lib/herdr/client.ts)')],
    [350, () => { line('tl-out', 'Read 214 lines'); stopTyping(); tool('Read src/lib/herdr/client.ts'); typing(); }],
    [800, () => line('tl-tool', '<b>Search</b>(pattern: "; true", path: "src/lib")')],
    [350, () => { line('tl-out', 'Found 1 file'); stopTyping(); tool('Search "; true" in src/lib'); typing(); }],
    [1000, () => line('tl-say', found)],
    [400, () => {
      stopTyping();
      bubble('b-in', 'Found it. <code>listDirectories</code> appends <code>; true</code>, so an unreadable path exits 0 and looks exactly like an empty folder.');
    }],
    [1100, () => push(term, node('div', 'tl-ask',
      '<p>Before I write to client.ts: this changes what every caller of listDirectories sees on failure. Want me to go ahead?</p>' +
      '<p class="tl-opt on">1. Yes, go ahead</p><p class="tl-opt">2. No, tell me more first</p>'))],
    [450, () => {
      setStatus('waiting');
      ask.hidden = false;
      ask.classList.remove('enter');
      void ask.offsetWidth;
      ask.classList.add('enter');
      trim(phone);
    }],
    [350, () => banner.classList.add('show')],

    // The page opens here, on the frame that is already in the markup.
    [2600, () => banner.classList.remove('show'), 'start'],
    [800, press],
    [450, () => {
      ask.hidden = true;
      opt.classList.remove('pressed');
      bubble('b-out', 'Yes, go ahead');
      setStatus('working');
      const box = term.querySelector('.tl-ask');
      if (box) {
        box.classList.add('answered');
        box.lastElementChild.remove();
      }
    }],
    [600, typing],
    [700, () => line('tl-tool', '<b>Update</b>(src/lib/herdr/client.ts)')],
    [350, () => { line('tl-out', 'Updated with 9 additions and 3 removals'); stopTyping(); tool('Edit src/lib/herdr/client.ts'); typing(); }],
    [800, () => line('tl-tool', '<b>Bash</b>(npm test)')],
    [350, () => { line('tl-out', 'Tests: 118 passed'); stopTyping(); tool('Run npm test'); typing(); }],
    [900, () => line('tl-say', done)],
    [400, () => { stopTyping(); bubble('b-in', done); setStatus('idle'); }],
    [3800, () => scene.classList.add('fading')],
    [600, () => {}],
  ];

  let i = script.findIndex((step) => step[2] === 'start');
  let timer = null;
  let onScreen = false;

  const live = () => onScreen && !document.hidden;

  const run = () => {
    if (timer !== null || !live()) return;
    const [wait, fn] = script[i];
    timer = setTimeout(() => {
      timer = null;
      if (!live()) return;
      fn();
      i = (i + 1) % script.length;
      run();
    }, wait);
  };

  // Pausing drops the pending step; resuming waits its full delay again.
  const pause = () => { clearTimeout(timer); timer = null; };

  new IntersectionObserver(([e]) => {
    onScreen = e.isIntersecting;
    if (onScreen) run(); else pause();
  }, { threshold: 0.3 }).observe(scene);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause(); else run();
  });
})();
