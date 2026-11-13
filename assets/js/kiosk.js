/*
 * Bunzo voice kiosk.
 *
 * Loads the DeepTalk voice widget headlessly and drives it through its public API
 * (init, start, end, setContext, onStatusChange). The order on screen comes from the
 * agent's own tool calls, read from the live events that DeepTalk already sends on the
 * widget's signaling socket: add_item, update_item, remove_item, show_menu,
 * safe_calculator, place_order and end_conversation.
 */
(() => {
  'use strict';

  const API = 'https://deeptalk-official-dev.deeptalk.work';
  const EMBED_TOKEN = 'emb_ec1EYrN7YKoZF9RFt-q4onQH6pnUFJA5Qpt6qD3bZzE';
  const RESET_AFTER_PLACED_S = 20;
  const RESET_AFTER_END_S = 8;
  const FAVOURITES = ['double_stack', 'firecracker_chicken', 'fries', 'shake', 'fountain_drink'];
  const HINTS = [
    'A Double Stack combo with a large Zero Cola',
    'Two Bunzo Classics, no pickles',
    'What shakes do you have?',
    'A 9 piece Chicken Bites with ranch',
    'Large fries and a strawberry shake',
  ];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Taps, installed before the widget script loads ---------- */

  // The widget does not use the platform's live "rtf-*" events, so read them off its socket.
  const NativeWebSocket = window.WebSocket;
  window.WebSocket = class extends NativeWebSocket {
    constructor(url, protocols) {
      super(url, protocols);
      if (String(url).includes('/ws/public/signaling/')) {
        this.addEventListener('message', (event) => {
          let message;
          try { message = JSON.parse(event.data); } catch { return; }
          if (message && typeof message.type === 'string' && message.type.startsWith('rtf-')) handleLive(message);
        });
      }
    }
  };

  // Keep a handle on the microphone stream for the level meter.
  const media = navigator.mediaDevices;
  if (media && typeof media.getUserMedia === 'function') {
    const nativeGetUserMedia = media.getUserMedia.bind(media);
    media.getUserMedia = (constraints) => nativeGetUserMedia(constraints).then((stream) => {
      if (constraints && constraints.audio) levels.attach('mic', stream);
      return stream;
    });
  }

  /* ---------- DOM ---------- */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const body = document.body;
  const el = {
    screens: { attract: $('[data-screen="attract"]'), live: $('[data-screen="live"]'), placed: $('[data-screen="placed"]') },
    panels: { hello: $('[data-panel="hello"]'), item: $('[data-panel="item"]'), menu: $('[data-panel="menu"]') },
    start: $('[data-start]'), startLabel: $('[data-start-label]'), hint: $('[data-hint]'), favs: $('[data-favs]'),
    attractStatus: $('[data-attract-status]'),
    bag: $('[data-bag]'), bagCount: $('[data-bag-count]'), bagTotal: $('[data-bag-total]'),
    order: $('[data-order]'), orderToggle: $('[data-order-toggle]'), orderCount: $('[data-order-count]'),
    orderEmpty: $('[data-order-empty]'), orderLines: $('[data-order-lines]'), orderTotal: $('[data-order-total]'), orderNote: $('[data-order-note]'),
    caption: $('[data-caption-text]'), transcript: $('[data-transcript]'), transcriptText: $('[data-transcript-text]'),
    latency: $('[data-latency]'), latencyText: $('[data-latency-text]'), sound: $('[data-sound]'), orb: $('[data-orb]'),
    sheet: $('[data-sheet]'), sheetTabs: $('[data-sheet-tabs]'), sheetGrid: $('[data-sheet-grid]'),
    trace: $('[data-trace]'), traceList: $('[data-trace-list]'),
    placedNumber: $('[data-order-number]'), placedLines: $('[data-placed-lines]'), placedTotal: $('[data-placed-total]'),
    resetCount: $('[data-reset-count]'), newOrder: $('[data-new-order]'), confetti: $('[data-confetti]'), toast: $('[data-toast]'),
  };

  /* ---------- Menu ---------- */

  let MENU = null;
  const ITEMS = {};
  const icon = (name) => `assets/img/food/${name}.png`;
  const money = (v) => `$${(Math.round(v * 100) / 100).toFixed(2)}`;
  const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const choiceSet = (item) => (item.choice ? MENU.choice_sets[item.choice] : null);
  const choiceName = (setId, id) => (MENU.choice_sets[setId].options.find((o) => o.id === id) || {}).name || id;
  const fromPrice = (item) => (item.sizes ? `from ${money(Math.min(...item.sizes.map((s) => s.price)))}` : money(item.price));

  const ACCENT_BY_CHOICE = {
    shake: { chocolate: 'chocolate_bar', strawberry: 'strawberry', cookies_and_cream: 'cookie' },
    soft_serve: { chocolate: 'chocolate_bar' },
    lemonade: { strawberry: 'strawberry', classic: 'lemon' },
    fountain_drink: { lemon_lime: 'lemon', zero_cola: 'ice' },
    chicken_bites: { honey_mustard: 'honey_pot', buffalo: 'hot_pepper' },
  };
  function artImages(item, choice) {
    const accent = (ACCENT_BY_CHOICE[item.id] && ACCENT_BY_CHOICE[item.id][choice]) || item.accent;
    return `<img class="art__main" src="${icon(item.icon)}" alt="">${accent ? `<img class="art__accent" src="${icon(accent)}" alt="">` : ''}`;
  }
  const art = (item, choice) => `<span class="art">${artImages(item, choice)}</span>`;

  /* ---------- Order model ---------- */

  const state = {
    phase: 'loading', // loading | idle | connecting | live | placed | ended | unavailable
    lines: new Map(), // line number -> { line, item_id, quantity, size, choice, modifiers, combo, combo_drink }
    focus: null,
    panel: 'hello',
    widget: null,
    connected: false,
    placed: false,
    farewell: false,
    soundOn: true,
    resetTimer: null,
    userFinal: '',
    captionFresh: true,
    captionText: '',
    captionLogged: true,
    shownTotal: 0,
  };

  function pickSize(item, raw) {
    if (!item.sizes || raw == null || raw === '') return undefined;
    const v = norm(raw);
    let size = item.sizes.find((s) => s.id === v || norm(s.name) === v);
    const aliases = { medium: ['regular'], regular: ['medium'], small: ['kids'], kids: ['small'], kid: ['kids', 'small'] };
    for (const alt of size ? [] : aliases[v] || []) {
      size = item.sizes.find((s) => s.id === alt);
      if (size) break;
    }
    if (!size) {
      const digits = v.match(/\d+/);
      if (digits) size = item.sizes.find((s) => s.id.startsWith(`${digits[0]}_`));
    }
    return size ? size.id : undefined;
  }
  function pickChoice(setId, raw) {
    if (!setId || raw == null || raw === '') return undefined;
    const v = norm(raw);
    const option = MENU.choice_sets[setId].options.find((o) => o.id === v || norm(o.name) === v);
    return option ? option.id : undefined;
  }
  function pickModifiers(item, raw) {
    if (raw == null) return undefined;
    const list = Array.isArray(raw) ? raw : String(raw).split(',');
    const out = [];
    for (const m of list) {
      const v = norm(m);
      if (v && item.modifiers.includes(v) && !out.includes(v)) out.push(v);
    }
    return out;
  }
  function pickCombo(item, raw) {
    if (raw == null || raw === '') return undefined;
    const v = norm(raw);
    if (['none', 'no', 'false', 'null'].includes(v)) return null;
    if (!item.combo) return undefined;
    return v.includes('large') ? 'large' : 'regular';
  }
  function applyFields(line, item, args) {
    const has = (k) => Object.prototype.hasOwnProperty.call(args, k);
    if (has('quantity')) {
      const q = Math.round(Number(args.quantity));
      if (q >= 1) line.quantity = Math.min(q, 99);
    }
    if (has('size')) { const v = pickSize(item, args.size); if (v !== undefined) line.size = v; }
    if (has('choice')) { const v = pickChoice(item.choice, args.choice); if (v !== undefined) line.choice = v; }
    if (has('modifiers')) { const v = pickModifiers(item, args.modifiers); if (v !== undefined) line.modifiers = v; }
    if (has('combo')) {
      const v = pickCombo(item, args.combo);
      if (v !== undefined) { line.combo = v; if (!v) line.combo_drink = null; }
    }
    if (has('combo_drink') && line.combo) {
      const v = pickChoice('fountain_flavors', args.combo_drink);
      if (v !== undefined) line.combo_drink = v;
    }
  }
  function unitPrice(line) {
    const item = ITEMS[line.item_id];
    let base = item.price;
    if (item.sizes) {
      const size = item.sizes.find((s) => s.id === line.size);
      if (!size) return null;
      base = size.price;
    }
    const mods = line.modifiers.reduce((sum, m) => sum + (MENU.modifiers[m] ? MENU.modifiers[m].price : 0), 0);
    return base + mods + (line.combo ? MENU.combo[line.combo].price : 0);
  }
  function lineTotal(line) {
    const unit = unitPrice(line);
    return unit === null ? null : Math.round(unit * line.quantity * 100) / 100;
  }
  function missing(line) {
    const item = ITEMS[line.item_id];
    const out = [];
    if (item.sizes && !line.size) out.push('size');
    if (item.choice && !line.choice) out.push(choiceSet(item).label.toLowerCase());
    if (line.combo && !line.combo_drink) out.push('combo drink');
    return out;
  }
  function lineTitle(line) {
    const item = ITEMS[line.item_id];
    const size = item.sizes && line.size ? `${item.sizes.find((s) => s.id === line.size).name} ` : '';
    const choice = line.choice ? choiceName(item.choice, line.choice) : '';
    if (choice && item.id === 'fountain_drink') return `${size}${choice}`;
    if (choice && item.id === 'shake') return `${size}${choice} Shake`;
    if (choice && item.id === 'soft_serve') return `${choice} Cone`;
    if (choice && item.id === 'lemonade') return `${size}${choice === 'Classic' ? '' : `${choice} `}Lemonade`;
    return `${size}${item.name}`;
  }
  function lineDetails(line) {
    const item = ITEMS[line.item_id];
    const parts = [];
    if (line.choice && item.id === 'chicken_bites') parts.push(`${choiceName(item.choice, line.choice)} dip`);
    if (line.combo) {
      const drink = line.combo_drink ? choiceName('fountain_flavors', line.combo_drink) : 'drink to choose';
      parts.push(`${MENU.combo[line.combo].name} with fries and ${drink}`);
    }
    for (const m of line.modifiers) parts.push(MENU.modifiers[m].name);
    return parts.join(' · ');
  }
  const sortedLines = () => [...state.lines.values()].sort((a, b) => a.line - b.line);
  const orderTotal = () => sortedLines().reduce((sum, l) => sum + (lineTotal(l) || 0), 0);
  const itemCount = () => sortedLines().reduce((sum, l) => sum + l.quantity, 0);

  /* ---------- Tool calls from the agent ---------- */

  function lineNumber(raw) {
    const n = Math.round(Number(raw));
    if (n >= 1) return n;
    return state.lines.size ? Math.max(...state.lines.keys()) + 1 : 1;
  }
  const TOOLS = {
    add_item(args) {
      const item = ITEMS[norm(args.item_id)];
      if (!item) return; // DeepTalk returns a 404 to the agent, which retries with a valid id
      const no = lineNumber(args.line);
      const line = { line: no, item_id: item.id, quantity: 1, size: null, choice: null, modifiers: [], combo: null, combo_drink: null };
      applyFields(line, item, args);
      state.lines.set(no, line);
      renderOrder(no);
      showItem(no);
    },
    update_item(args) {
      const line = state.lines.get(Math.round(Number(args.line)));
      if (!line) return;
      applyFields(line, ITEMS[line.item_id], args);
      renderOrder(line.line);
      showItem(line.line);
    },
    remove_item(args) {
      const no = Math.round(Number(args.line));
      if (!state.lines.delete(no)) return;
      if (state.focus === no) { state.focus = null; switchPanel('hello'); }
      renderOrder();
    },
    show_menu(args) {
      showMenuPanel(norm(args.category));
    },
    safe_calculator() {
      el.orderTotal.classList.add('is-calc');
      el.orderNote.textContent = 'Adding it up…';
      openOrderOnSmallScreens(true);
      pop(el.orderTotal, 1.12);
    },
    place_order() { placeOrder(); },
    end_conversation() {
      state.farewell = true;
      toast('Thanks for stopping by Bunzo!');
    },
  };

  /* ---------- Live events from the call ---------- */

  function handleLive(message) {
    const p = message.payload || {};
    switch (message.type) {
      case 'rtf-user-transcription': {
        const text = String(p.text || '').trim();
        if (!text) break;
        if (p.final) {
          state.userFinal = `${state.userFinal} ${text}`.trim();
          setTranscript(state.userFinal, false);
          setAgent('thinking');
          state.captionFresh = true;
          trace('you', text);
        } else {
          setTranscript(`${state.userFinal} ${text}`.trim(), true);
        }
        break;
      }
      case 'rtf-bot-started-speaking':
        state.captionFresh = true;
        setAgent('speaking');
        break;
      case 'rtf-bot-text': {
        const text = String(p.text || '').trim();
        if (!text) break;
        if (state.captionFresh) {
          logCaption();
          state.captionLogged = false;
          state.captionText = text;
          state.captionFresh = false;
          state.userFinal = '';
        } else {
          state.captionText = `${state.captionText} ${text}`;
        }
        setCaption(state.captionText);
        break;
      }
      case 'rtf-bot-stopped-speaking':
        logCaption();
        setAgent('listening');
        if (!state.userFinal) setTranscript('', false);
        break;
      case 'rtf-function-call-start': {
        const name = p.function_name || '';
        const args = p.arguments || {};
        trace('tool', `${name}(${compactArgs(args)})`);
        if (TOOLS[name] && MENU) {
          try { TOOLS[name](args); } catch (err) { console.error('Tool render failed', name, err); }
        }
        break;
      }
      case 'rtf-function-call-end': {
        const result = String(p.result || '');
        if (/status_code['"]?:\s*4\d\d|'status': 'error'/.test(result)) trace('sys', `${p.function_name} returned an error, the agent retries`);
        break;
      }
      case 'rtf-latency-measured':
        if (typeof p.latency_seconds === 'number') {
          el.latency.hidden = false;
          el.latencyText.textContent = `${p.latency_seconds.toFixed(1)} s`;
          trace('metric', `voice to voice ${p.latency_seconds.toFixed(2)} s`);
        }
        break;
      case 'rtf-ttfb-metric':
        if (typeof p.ttfb_seconds === 'number') trace('metric', `${(p.kind || 'llm').toUpperCase()} first byte ${p.ttfb_seconds.toFixed(2)} s`);
        break;
      case 'rtf-node-transition':
        if (p.node_name) trace('sys', `step: ${p.node_name}`);
        break;
      case 'rtf-pipeline-error':
        trace('sys', `error: ${p.error || 'unknown'}`);
        break;
      default:
        break;
    }
  }
  function logCaption() {
    if (state.captionText && !state.captionLogged) trace('bot', state.captionText.replace(/\s+([,.!?;:])/g, '$1'));
    state.captionLogged = true;
  }
  function compactArgs(args) {
    return Object.entries(args).map(([k, v]) => `${k}: ${typeof v === 'string' ? `"${v}"` : JSON.stringify(v)}`).join(', ');
  }

  /* ---------- Rendering: dock ---------- */

  function setTranscript(text, interim) {
    el.transcriptText.textContent = text;
    el.transcript.classList.toggle('has-text', Boolean(text));
    el.transcript.classList.toggle('is-interim', Boolean(interim));
  }
  function setCaption(text) {
    el.caption.textContent = text.replace(/\s+([,.!?;:])/g, '$1').replace(/\s{2,}/g, ' ');
  }
  function setAgent(mode) {
    body.dataset.agent = mode;
  }

  /* ---------- Rendering: order panel ---------- */

  const lineEls = new Map();
  function orderLineHTML(line) {
    const item = ITEMS[line.item_id];
    const total = lineTotal(line);
    const need = missing(line);
    const details = lineDetails(line);
    return `<span class="art">${artImages(item, line.choice)}${line.quantity > 1 ? `<span class="oline__qty">${line.quantity}×</span>` : ''}</span>
      <span class="oline__text"><span class="oline__name">${esc(lineTitle(line))}</span>${details ? `<br><span class="oline__detail">${esc(details)}</span>` : ''}${need.length ? `<br><span class="oline__need">Needs ${esc(need.join(', '))}</span>` : ''}</span>
      <span class="oline__price${total === null ? ' is-pending' : ''}">${total === null ? esc(fromPrice(item)) : money(total)}</span>`;
  }
  function renderOrder(changed) {
    for (const [no, node] of lineEls) {
      if (!state.lines.has(no)) {
        lineEls.delete(no);
        if (gsapOk()) gsap.to(node, { height: 0, opacity: 0, paddingTop: 0, paddingBottom: 0, x: 30, duration: 0.35, ease: 'power2.in', onComplete: () => node.remove() });
        else node.remove();
      }
    }
    for (const line of sortedLines()) {
      let node = lineEls.get(line.line);
      const fresh = !node;
      if (fresh) {
        node = document.createElement('li');
        node.className = 'oline';
        lineEls.set(line.line, node);
        const after = [...lineEls.keys()].filter((n) => n > line.line).sort((a, b) => a - b)[0];
        el.orderLines.insertBefore(node, after ? lineEls.get(after) : null);
      }
      const html = orderLineHTML(line);
      if (node.dataset.html !== html) {
        node.innerHTML = html;
        node.dataset.html = html;
        if (!fresh && line.line === changed) flash(node);
      }
      node.classList.toggle('is-focus', line.line === state.focus);
      if (fresh && gsapOk()) {
        gsap.from(node, { x: 40, opacity: 0, duration: 0.5, ease: 'back.out(1.6)' });
        flash(node);
      }
      if (line.line === changed) node.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
    }
    const count = itemCount();
    const label = `${count} item${count === 1 ? '' : 's'}`;
    el.orderCount.textContent = label;
    el.bagCount.textContent = label;
    el.orderEmpty.hidden = state.lines.size > 0;
    el.bag.hidden = state.lines.size === 0;
    el.orderTotal.classList.remove('is-calc');
    const pending = sortedLines().some((l) => lineTotal(l) === null);
    el.orderNote.textContent = pending ? 'Total so far. Prices include tax.' : 'Prices include tax.';
    tweenTotal(orderTotal());
    if (changed) openOrderOnSmallScreens();
  }
  function tweenTotal(target) {
    const render = (v) => { el.orderTotal.textContent = money(v); el.bagTotal.textContent = money(v); };
    if (!gsapOk()) { state.shownTotal = target; render(target); return; }
    const counter = { v: state.shownTotal };
    gsap.to(counter, { v: target, duration: 0.6, ease: 'power2.out', onUpdate: () => render(counter.v), onComplete: () => render(target) });
    state.shownTotal = target;
  }
  function flash(node) {
    if (!gsapOk()) return;
    gsap.fromTo(node, { backgroundColor: '#FFE7A8' }, { backgroundColor: 'rgba(255,255,255,0)', duration: 1.2, ease: 'power2.out', clearProps: 'backgroundColor' });
  }
  // On small screens the order panel opens by itself only on tall screens or for the read-back.
  function openOrderOnSmallScreens(force = false) {
    if (!force && window.innerHeight < 1000) return;
    if (window.matchMedia('(max-width: 1000px), (max-aspect-ratio: 4/5)').matches) {
      el.order.classList.add('is-open');
      el.orderToggle.setAttribute('aria-expanded', 'true');
    }
  }

  /* ---------- Rendering: main panels ---------- */

  function switchPanel(name) {
    if (state.panel === name && !el.panels[name].hidden) return;
    const prev = el.panels[state.panel];
    const next = el.panels[name];
    state.panel = name;
    Object.entries(el.panels).forEach(([key, node]) => { if (key !== name && node !== prev) node.hidden = true; });
    next.hidden = false;
    if (gsapOk()) {
      gsap.killTweensOf(next);
      if (prev && prev !== next) {
        gsap.to(prev, {
          opacity: 0, y: -16, duration: 0.25, ease: 'power2.in',
          onComplete: () => { if (el.panels[state.panel] !== prev) prev.hidden = true; gsap.set(prev, { clearProps: 'opacity,transform' }); },
        });
      }
      gsap.fromTo(next, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power3.out', delay: prev && prev !== next ? 0.12 : 0 });
    } else if (prev && prev !== next) {
      prev.hidden = true;
    }
    if (name !== 'item') { state.focus = null; lineEls.forEach((n) => n.classList.remove('is-focus')); }
  }

  function groupHTML(key, label, options, selected, need, extraClass = '') {
    const chips = options.map((o) => `<button type="button" tabindex="-1" class="chip-opt${o.off ? ' is-off' : ''}${selected.includes(o.id) ? ' is-on' : ''}" data-value="${esc(o.id)}">${esc(o.name)}${o.price ? ` <small>${o.price}</small>` : ''}</button>`).join('');
    return `<div class="group${need ? ' group--need' : ''} ${extraClass}" data-group="${key}">
      <div class="group__head"><span class="group__label">${esc(label)}</span>${need ? '<span class="group__need">Choose one</span>' : ''}</div>
      <div class="chips">${chips}</div></div>`;
  }
  function itemGroups(line, item) {
    const groups = [];
    const need = missing(line);
    if (item.sizes) groups.push(groupHTML('size', 'Size', item.sizes.map((s) => ({ id: s.id, name: s.name, price: money(s.price) })), [line.size], need.includes('size')));
    if (item.choice) {
      const set = choiceSet(item);
      groups.push(groupHTML('choice', set.label, set.options.map((o) => ({ id: o.id, name: o.name })), [line.choice], need.includes(set.label.toLowerCase())));
    }
    if (item.combo) {
      groups.push(groupHTML('combo', 'Make it a combo', [
        { id: 'regular', name: 'Regular combo', price: `+${money(MENU.combo.regular.price)}` },
        { id: 'large', name: 'Large combo', price: `+${money(MENU.combo.large.price)}` },
      ], [line.combo], false));
      if (line.combo) {
        const set = MENU.choice_sets.fountain_flavors;
        groups.push(groupHTML('combo_drink', 'Combo drink', set.options.map((o) => ({ id: o.id, name: o.name })), [line.combo_drink], need.includes('combo drink')));
      }
    }
    const extras = item.modifiers.filter((m) => MENU.modifiers[m].price > 0);
    const yourWay = item.modifiers.filter((m) => MENU.modifiers[m].price === 0);
    if (extras.length) groups.push(groupHTML('extras', 'Extras', extras.map((m) => ({ id: m, name: MENU.modifiers[m].name, price: `+${money(MENU.modifiers[m].price)}` })), line.modifiers, false));
    if (yourWay.length) groups.push(groupHTML('your_way', 'Your way', yourWay.map((m) => ({ id: m, name: MENU.modifiers[m].name, off: true })), line.modifiers, false));
    return groups.join('');
  }
  function itemPriceHTML(line, item) {
    const total = lineTotal(line);
    return `<span class="item__price" data-item-price>${total === null ? esc(fromPrice(item)) : money(total)}</span>${line.quantity > 1 ? `<span class="item__qty">${line.quantity} × ${money(unitPrice(line))}</span>` : ''}<span class="item__cal">${item.calories} cal</span>`;
  }
  function showItem(no) {
    const line = state.lines.get(no);
    if (!line) return;
    const item = ITEMS[line.item_id];
    const panel = el.panels.item;
    const same = state.panel === 'item' && state.focus === no && panel.dataset.item === item.id && !panel.hidden;
    state.focus = no;
    lineEls.forEach((n, k) => n.classList.toggle('is-focus', k === no));
    if (same) {
      const before = new Set($$('.chip-opt.is-on', panel).map((c) => `${c.closest('[data-group]').dataset.group}:${c.dataset.value}`));
      $('.item__groups', panel).innerHTML = itemGroups(line, item);
      $('.item__price-row', panel).innerHTML = itemPriceHTML(line, item);
      $('.item__title', panel).textContent = lineTitle(line);
      const artNode = $('.item__art .art', panel);
      artNode.outerHTML = art(item, line.choice);
      $$('.chip-opt.is-on', panel).forEach((chip) => {
        if (!before.has(`${chip.closest('[data-group]').dataset.group}:${chip.dataset.value}`)) pop(chip, 1.18);
      });
      pop($('[data-item-price]', panel), 1.1);
      return;
    }
    const category = MENU.categories.find((c) => c.id === item.category);
    panel.dataset.item = item.id;
    panel.innerHTML = `
      <div class="item__art"><span class="item__glow"></span>${art(item, line.choice)}<span class="item__shadow"></span></div>
      <div class="item__body">
        <span class="item__kicker">${esc(category ? category.name : '')}<span class="dot"></span>Line ${line.line}</span>
        <h2 class="item__name item__title">${esc(lineTitle(line))}</h2>
        <p class="item__desc">${esc(item.description)}</p>
        <div class="item__price-row">${itemPriceHTML(line, item)}</div>
        <div class="item__groups">${itemGroups(line, item)}</div>
      </div>`;
    switchPanel('item');
    if (gsapOk()) {
      gsap.fromTo($('.item__art .art', panel), { scale: 0.4, rotate: -14, opacity: 0 }, { scale: 1, rotate: 0, opacity: 1, duration: 0.9, ease: 'elastic.out(1, 0.6)' });
      gsap.fromTo($('.item__glow', panel), { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.8, ease: 'power2.out' });
      gsap.from($$('.item__body > *', panel), { y: 18, opacity: 0, duration: 0.45, stagger: 0.06, ease: 'power3.out', delay: 0.1 });
    }
  }
  function cardHTML(item) {
    return `<div class="mcard">${art(item, item.id === 'shake' ? 'cookies_and_cream' : null)}<span class="mcard__name">${esc(item.name)}</span><span class="mcard__desc">${esc(item.description)}</span><span class="mcard__price">${esc(fromPrice(item))}</span></div>`;
  }
  function showMenuPanel(categoryId) {
    const category = MENU.categories.find((c) => c.id === categoryId);
    const items = MENU.items.filter((i) => !category || i.category === category.id);
    const panel = el.panels.menu;
    panel.innerHTML = `<div class="menu__head"><img src="${icon(category ? category.icon : 'hamburger')}" alt=""><h2 class="menu__title">${esc(category ? category.name : 'The full menu')}</h2></div>
      <div class="menu__grid">${items.map(cardHTML).join('')}</div>`;
    switchPanel('menu');
    if (gsapOk()) gsap.from($$('.mcard', panel), { y: 30, opacity: 0, scale: 0.94, duration: 0.5, stagger: 0.05, ease: 'back.out(1.5)', delay: 0.1 });
  }

  /* ---------- Screens ---------- */

  function setPhase(phase) {
    state.phase = phase;
    body.dataset.phase = phase;
    const live = phase === 'connecting' || phase === 'live';
    el.orb.setAttribute('aria-label', live ? 'End your order' : 'Start your order');
    el.start.disabled = phase === 'loading' || phase === 'unavailable' || phase === 'connecting';
    el.startLabel.textContent = {
      loading: 'Getting ready…', unavailable: 'Kiosk unavailable', connecting: 'Connecting…',
    }[phase] || 'Tap to start your order';
    $('[data-transcript-placeholder]').textContent = {
      connecting: 'Connecting…', live: 'Listening… say your order', placed: 'Thanks for ordering!', ended: 'Session ended',
    }[phase] || 'Say your order out loud';
  }
  let currentScreen = 'attract';
  function switchScreen(name) {
    currentScreen = name;
    Object.entries(el.screens).forEach(([key, node]) => {
      if (key === name || node.hidden) return;
      if (gsapOk()) {
        gsap.to(node, {
          opacity: 0, y: -24, duration: 0.3, ease: 'power2.in',
          onComplete: () => { if (currentScreen !== key) node.hidden = true; gsap.set(node, { clearProps: 'opacity,transform' }); },
        });
      } else {
        node.hidden = true;
      }
    });
    const next = el.screens[name];
    if (gsapOk()) gsap.killTweensOf(next);
    if (!next.hidden) { if (gsapOk()) gsap.set(next, { clearProps: 'opacity,transform' }); return; }
    next.hidden = false;
    if (gsapOk()) gsap.fromTo(next, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out', delay: 0.15 });
  }

  function placeOrder() {
    if (state.placed) return;
    state.placed = true;
    $('[data-transcript-placeholder]').textContent = 'Thanks for ordering!';
    setTranscript('', false);
    const lines = sortedLines();
    const number = `B-${String(Math.floor(100 + Math.random() * 900))}`;
    el.placedLines.innerHTML = lines.map((l) => `<li><span>${l.quantity}× ${esc(lineTitle(l))}${l.combo ? ` ${l.combo === 'large' ? 'large ' : ''}combo` : ''}</span><span>${lineTotal(l) === null ? '' : money(lineTotal(l))}</span></li>`).join('');
    el.placedTotal.textContent = money(orderTotal());
    el.resetCount.textContent = '';
    switchScreen('placed');
    rollNumber(number);
    if (gsapOk()) {
      gsap.fromTo('.placed__check', { scale: 0, rotate: -40 }, { scale: 1, rotate: 0, duration: 0.8, ease: 'back.out(2.2)', delay: 0.2 });
      gsap.from(['.placed__title', '.placed__label', '.placed__card', '.placed__pay', '[data-new-order]'], { y: 20, opacity: 0, duration: 0.5, stagger: 0.08, delay: 0.35, ease: 'power3.out' });
      confetti();
    }
  }
  function rollNumber(number) {
    if (!gsapOk()) { el.placedNumber.textContent = number; return; }
    const digits = '0123456789';
    const counter = { t: 0 };
    gsap.to(counter, {
      t: 1, duration: 1.1, delay: 0.3, ease: 'power2.out',
      onUpdate: () => {
        el.placedNumber.textContent = number.split('').map((ch, i) => (/\d/.test(ch) && counter.t < 0.3 + i * 0.15 ? digits[Math.floor(Math.random() * 10)] : ch)).join('');
      },
      onComplete: () => { el.placedNumber.textContent = number; pop(el.placedNumber, 1.08); },
    });
  }
  function confetti() {
    const box = el.confetti;
    box.innerHTML = '';
    const pics = ['hamburger', 'french_fries', 'cup_with_straw', 'soft_ice_cream', 'hot_dog', 'sparkles', 'party_popper', 'cookie', 'glowing_star'];
    for (let i = 0; i < 28; i += 1) {
      const img = document.createElement('img');
      img.src = icon(pics[i % pics.length]);
      img.alt = '';
      box.appendChild(img);
      const angle = Math.random() * Math.PI * 2;
      const dist = 180 + Math.random() * Math.min(window.innerWidth, 900) * 0.45;
      gsap.timeline()
        .fromTo(img, { x: -24, y: -24, scale: 0.2, rotate: 0, opacity: 1 }, { x: Math.cos(angle) * dist - 24, y: Math.sin(angle) * dist * 0.7 - 80, scale: 0.6 + Math.random() * 0.7, rotate: (Math.random() - 0.5) * 540, duration: 0.9 + Math.random() * 0.4, ease: 'power3.out' })
        .to(img, { y: `+=${260 + Math.random() * 220}`, opacity: 0, rotate: `+=${(Math.random() - 0.5) * 200}`, duration: 1.4 + Math.random() * 0.6, ease: 'power1.in' });
    }
  }

  function resetKiosk() {
    clearInterval(state.resetTimer);
    state.resetTimer = null;
    state.lines.clear();
    lineEls.forEach((n) => n.remove());
    lineEls.clear();
    state.focus = null;
    state.placed = false;
    state.farewell = false;
    state.connected = false;
    state.userFinal = '';
    state.captionText = '';
    state.captionFresh = true;
    state.shownTotal = 0;
    renderOrder();
    el.order.classList.remove('is-open');
    el.panels.item.innerHTML = '';
    el.panels.item.dataset.item = '';
    el.panels.menu.innerHTML = '';
    switchPanel('hello');
    setTranscript('', false);
    setCaption("Hi! Tap the button and tell me what you'd like.");
    setAgent('idle');
    el.latency.hidden = true;
    el.confetti.innerHTML = '';
    setPhase('idle');
    switchScreen('attract');
  }
  function countdown(seconds, onDone, label) {
    clearInterval(state.resetTimer);
    let left = seconds;
    const tick = () => {
      if (label) label.textContent = `(${left})`;
      if (left <= 0) { clearInterval(state.resetTimer); state.resetTimer = null; onDone(); }
      left -= 1;
    };
    tick();
    state.resetTimer = setInterval(tick, 1000);
  }

  /* ---------- Widget ---------- */

  function onStatus(status, _text, subtext) {
    if (status === 'connecting') {
      setPhase('connecting');
      setCaption('Connecting to the Bunzo assistant…');
    } else if (status === 'connected') {
      state.connected = true;
      setPhase('live');
      setAgent('listening');
      setCaption('…');
      applySound();
      watchBotAudio();
    } else if (status === 'failed') {
      levels.detach('bot');
      const wasLive = state.connected;
      setPhase('idle');
      if (state.placed) { countdown(RESET_AFTER_PLACED_S, resetKiosk, el.resetCount); return; }
      if (wasLive) {
        toast('The connection dropped. Tap to start again.');
        countdown(RESET_AFTER_END_S, resetKiosk);
      } else {
        resetKiosk();
        const detail = subtext && !/^click/i.test(subtext) ? subtext : '';
        el.attractStatus.textContent = /microphone|permission|denied|notallowed/i.test(detail)
          ? 'Please allow the microphone to order by voice.'
          : detail || 'We could not connect. Please tap to try again.';
      }
    } else if (status === 'idle') {
      levels.detach('bot');
      const wasLive = state.connected;
      state.connected = false;
      if (state.placed) {
        setPhase('placed');
        countdown(RESET_AFTER_PLACED_S, resetKiosk, el.resetCount);
      } else if (wasLive) {
        setPhase('ended');
        setAgent('idle');
        if (!state.farewell) toast('Your session has ended.');
        countdown(state.lines.size ? RESET_AFTER_END_S : 3, resetKiosk);
      } else if (state.phase === 'connecting') {
        resetKiosk();
      }
    }
  }

  function startOrder() {
    if (!state.widget || state.phase !== 'idle') return;
    el.attractStatus.textContent = '';
    levels.prime(); // inside the tap, so the browser allows audio analysis
    state.widget.setContext({ channel: 'kiosk', kiosk_id: 'bunzo-demo-1', today: new Date().toISOString().slice(0, 10) });
    switchScreen('live');
    switchPanel('hello');
    setPhase('connecting');
    try {
      const result = state.widget.start();
      if (result && typeof result.catch === 'function') result.catch(() => onStatus('failed'));
    } catch {
      onStatus('failed');
    }
  }
  function endOrder() {
    if (!state.widget) return;
    if (state.phase === 'connecting' || state.phase === 'live') state.widget.end();
  }
  function applySound() {
    $$('audio').forEach((a) => { a.muted = !state.soundOn; });
  }

  function loadWidget() {
    const script = document.createElement('script');
    script.id = 'deeptalk-widget';
    script.async = true;
    script.src = `${API}/embed/deeptalk-widget.js?token=${EMBED_TOKEN}&environment=production&apiEndpoint=${API}`;
    script.setAttribute('data-deeptalk-context', JSON.stringify({ channel: 'kiosk', page_url: window.location.href }));
    script.onerror = () => setPhase('unavailable');
    document.head.appendChild(script);
    const started = Date.now();
    (function waitForWidget() {
      if (!window.DeepTalkWidget) {
        if (Date.now() - started > 20000) { setPhase('unavailable'); el.attractStatus.textContent = 'The kiosk is offline. Please refresh in a moment.'; return; }
        setTimeout(waitForWidget, 100);
        return;
      }
      const widget = window.DeepTalkWidget;
      widget.onStatusChange(onStatus);
      widget.onError((err) => { if (err && err.message && !/container element/i.test(err.message)) console.warn('Widget:', err.message); });
      Promise.resolve(widget.init())
        .then(() => {
          const ok = widget.getState && widget.getState().isInitialized;
          state.widget = ok ? widget : null;
          setPhase(ok ? 'idle' : 'unavailable');
          if (!ok) el.attractStatus.textContent = 'The kiosk is offline. Please refresh in a moment.';
        })
        .catch(() => setPhase('unavailable'));
    })();
  }

  /* ---------- Audio levels for the orb ---------- */

  const levels = (() => {
    let ctx = null;
    const sources = {};
    const values = { mic: 0, bot: 0 };
    let raf = 0;
    function prime() {
      try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
      } catch { ctx = null; }
      if (!raf) loop();
    }
    function attach(kind, stream) {
      if (!ctx || !stream || !stream.getAudioTracks().length) return;
      detach(kind);
      try {
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser); // analysis only, the widget plays the audio
        sources[kind] = { source, analyser, buf: new Uint8Array(analyser.fftSize) };
      } catch { /* analysis is optional */ }
    }
    function detach(kind) {
      const s = sources[kind];
      if (!s) return;
      try { s.source.disconnect(); } catch { /* gone */ }
      delete sources[kind];
      values[kind] = 0;
    }
    function read(kind) {
      const s = sources[kind];
      if (!s) return 0;
      s.analyser.getByteTimeDomainData(s.buf);
      let sum = 0;
      for (let i = 0; i < s.buf.length; i += 1) { const v = (s.buf[i] - 128) / 128; sum += v * v; }
      return Math.min(1, Math.sqrt(sum / s.buf.length) * 5);
    }
    function loop() {
      ['mic', 'bot'].forEach((k) => {
        const v = read(k);
        values[k] += (v - values[k]) * (v > values[k] ? 0.4 : 0.12);
      });
      const live = state.phase === 'live';
      const level = live ? Math.max(values.bot, values.mic * 0.9) : 0;
      el.orb.style.setProperty('--level', level.toFixed(3));
      raf = requestAnimationFrame(loop);
    }
    return { prime, attach, detach };
  })();
  function watchBotAudio(tries = 0) {
    const audio = $('#deeptalk-inline-container audio') || $('audio');
    const stream = audio && audio.srcObject;
    if (stream && stream.getAudioTracks().length) { levels.attach('bot', stream); return; }
    if (tries < 40 && state.connected) setTimeout(() => watchBotAudio(tries + 1), 250);
  }

  /* ---------- Small helpers ---------- */

  function gsapOk() { return !reduceMotion && typeof window.gsap !== 'undefined'; }
  function pop(node, scale = 1.1) {
    if (!node || !gsapOk()) return;
    gsap.fromTo(node, { scale }, { scale: 1, duration: 0.5, ease: 'back.out(3)' });
  }
  let toastTimer = 0;
  function toast(text) {
    el.toast.textContent = text;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    if (gsapOk()) gsap.fromTo(el.toast, { y: -20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: 'power3.out' });
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 4000);
  }
  const traceStart = performance.now();
  function trace(kind, text) {
    const labels = { you: 'You', bot: 'Agent', tool: 'Tool', metric: 'Metric', sys: 'System' };
    const li = document.createElement('li');
    const t = ((performance.now() - traceStart) / 1000).toFixed(1);
    li.innerHTML = `<span class="trace__t">${t}s</span><span class="trace__msg"><span class="trace__k trace__k--${kind}">${labels[kind]}</span>${esc(text)}</span>`;
    el.traceList.appendChild(li);
    while (el.traceList.children.length > 250) el.traceList.firstElementChild.remove();
    el.traceList.scrollTop = el.traceList.scrollHeight;
  }

  /* ---------- Attract screen, menu sheet, controls ---------- */

  function renderFavourites() {
    el.favs.innerHTML = FAVOURITES.map((id) => {
      const item = ITEMS[id];
      const tag = item.tags.includes('spicy') ? '<span class="fav__tag">Spicy</span>' : item.tags.includes('veggie') ? '<span class="fav__tag fav__tag--veggie">Veggie</span>' : '';
      return `<div class="fav">${tag}${art(item, id === 'shake' ? 'cookies_and_cream' : null)}<span class="fav__name">${esc(item.name)}</span><span class="fav__price">${esc(fromPrice(item))}</span></div>`;
    }).join('') + '<button class="fav fav--more" type="button" data-open-menu><span class="arrow" aria-hidden="true">→</span>See the full menu</button>';
  }
  function renderSheet(categoryId) {
    el.sheetTabs.innerHTML = MENU.categories.map((c) => `<button type="button" class="sheet__tab" role="tab" aria-selected="${c.id === categoryId}" data-tab="${c.id}"><img src="${icon(c.icon)}" alt="">${esc(c.name)}</button>`).join('');
    el.sheetGrid.innerHTML = MENU.items.filter((i) => i.category === categoryId).map(cardHTML).join('');
    if (gsapOk()) gsap.from($$('.mcard', el.sheetGrid), { y: 20, opacity: 0, duration: 0.4, stagger: 0.04, ease: 'power3.out' });
  }
  function openSheet() {
    renderSheet(MENU.categories[0].id);
    el.sheet.hidden = false;
    if (gsapOk()) {
      gsap.fromTo('.sheet__scrim', { opacity: 0 }, { opacity: 1, duration: 0.3 });
      gsap.fromTo('.sheet__panel', { yPercent: 100 }, { yPercent: 0, duration: 0.5, ease: 'power3.out' });
    }
  }
  function closeSheet() {
    if (el.sheet.hidden) return;
    if (gsapOk()) {
      gsap.to('.sheet__scrim', { opacity: 0, duration: 0.25 });
      gsap.to('.sheet__panel', { yPercent: 100, duration: 0.35, ease: 'power2.in', onComplete: () => { el.sheet.hidden = true; } });
    } else {
      el.sheet.hidden = true;
    }
  }
  function toggleTrace(force) {
    const open = typeof force === 'boolean' ? force : el.trace.hidden;
    el.trace.hidden = !open;
    $$('[data-trace-toggle]').forEach((b) => b.setAttribute('aria-expanded', String(open)));
    if (open && gsapOk()) gsap.fromTo(el.trace, { x: 40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.35, ease: 'power3.out' });
  }
  function rotateHints() {
    let i = 0;
    setInterval(() => {
      if (state.phase !== 'idle' || el.screens.attract.hidden) return;
      i = (i + 1) % HINTS.length;
      if (gsapOk()) {
        gsap.to(el.hint, { opacity: 0, y: -6, duration: 0.25, onComplete: () => { el.hint.textContent = HINTS[i]; gsap.fromTo(el.hint, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.3 }); } });
      } else {
        el.hint.textContent = HINTS[i];
      }
    }, 4200);
  }
  function intro() {
    document.documentElement.classList.remove('motion');
    if (!gsapOk()) return;
    const foods = $$('.hero-food');
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
    tl.from(foods, { y: -140, opacity: 0, rotate: () => gsap.utils.random(-30, 30), duration: 0.9, ease: 'bounce.out', stagger: 0.08 });
    const title = $('[data-split]');
    if (window.SplitText) {
      const split = new SplitText(title, { type: 'words,chars' });
      tl.from(split.chars, { y: 50, opacity: 0, rotate: 6, duration: 0.6, stagger: 0.018 }, 0.25);
    } else {
      tl.from(title, { y: 30, opacity: 0, duration: 0.6 }, 0.25);
    }
    tl.from($$('[data-intro]'), { y: 18, opacity: 0, duration: 0.5, stagger: 0.07 }, 0.55);
    tl.from($$('.fav'), { y: 30, opacity: 0, scale: 0.92, duration: 0.5, stagger: 0.06, ease: 'back.out(1.6)' }, 0.75);
    foods.forEach((food, i) => {
      gsap.to(food, { y: gsap.utils.random(-14, -6), rotate: gsap.utils.random(-6, 6), duration: gsap.utils.random(1.8, 2.6), repeat: -1, yoyo: true, ease: 'sine.inOut', delay: 1 + i * 0.15 });
    });
    gsap.to('.blob--a', { x: '6vw', y: '4vh', duration: 14, repeat: -1, yoyo: true, ease: 'sine.inOut' });
    gsap.to('.blob--b', { x: '-5vw', y: '6vh', duration: 17, repeat: -1, yoyo: true, ease: 'sine.inOut' });
    gsap.to('.blob--c', { x: '-4vw', y: '-5vh', duration: 19, repeat: -1, yoyo: true, ease: 'sine.inOut' });
    gsap.to('.hello__orb img', { rotate: 14, duration: 0.5, repeat: -1, yoyo: true, ease: 'sine.inOut', repeatDelay: 0.6 });
  }

  function bindControls() {
    el.start.addEventListener('click', startOrder);
    el.orb.addEventListener('click', () => {
      if (state.phase === 'idle') startOrder();
      else if (state.phase === 'connecting' || state.phase === 'live') endOrder();
    });
    el.newOrder.addEventListener('click', () => { endOrder(); resetKiosk(); });
    el.sound.addEventListener('click', () => {
      state.soundOn = !state.soundOn;
      el.sound.setAttribute('aria-pressed', String(state.soundOn));
      el.sound.textContent = state.soundOn ? 'Sound on' : 'Sound off';
      applySound();
    });
    el.orderToggle.addEventListener('click', () => {
      if (!window.matchMedia('(max-width: 1000px), (max-aspect-ratio: 4/5)').matches) return;
      const open = !el.order.classList.contains('is-open');
      el.order.classList.toggle('is-open', open);
      el.orderToggle.setAttribute('aria-expanded', String(open));
    });
    el.bag.addEventListener('click', () => openOrderOnSmallScreens(true));
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-open-menu]')) openSheet();
      else if (e.target.closest('[data-close-menu]')) closeSheet();
      else if (e.target.closest('[data-trace-toggle]')) toggleTrace();
      const tab = e.target.closest('[data-tab]');
      if (tab) renderSheet(tab.dataset.tab);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeSheet(); toggleTrace(false); }
    });
    window.addEventListener('pagehide', () => { if (state.widget && (state.phase === 'live' || state.phase === 'connecting')) state.widget.end(); });
  }

  /* ---------- Boot ---------- */

  async function boot() {
    bindControls();
    // Test hook: ?debug=1 lets a test replay live events without a call.
    if (new URLSearchParams(window.location.search).has('debug')) {
      window.BunzoKiosk = { event: handleLive, showLive: () => { switchScreen('live'); setPhase('live'); }, state };
    }
    setPhase('loading');
    try {
      const response = await fetch('menu.json', { cache: 'no-cache' });
      MENU = await response.json();
      MENU.items.forEach((item) => { ITEMS[item.id] = item; });
    } catch {
      document.documentElement.classList.remove('motion');
      setPhase('unavailable');
      el.attractStatus.textContent = 'The menu could not load. Please refresh the page.';
      return;
    }
    renderFavourites();
    intro();
    rotateHints();
    loadWidget();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
