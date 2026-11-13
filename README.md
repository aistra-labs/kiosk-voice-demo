# Bunzo voice kiosk

A static page that shows a voice ordering kiosk for Bunzo, an imaginary burger chain. The customer taps once and talks. The screen shows each item, its options and the running total while the agent takes the order.

Live at **https://aistra-labs.github.io/kiosk-voice-demo/** (GitHub Pages, `main` branch, root folder).

## How it works

- The agent runs on DeepTalk: **Bunzo Kiosk - Voice Ordering (Demo)** on the dev box. The page loads that agent's voice widget (Voice, Inline), keeps the widget's own panel hidden, and drives it through `window.DeepTalkWidget`.
- The agent changes the order only through tools. DeepTalk sends every tool call as a live event on the widget's signaling socket. `assets/js/kiosk.js` reads those events and draws the screen.
- The HTTP tools call static JSON files in `api/` on this site, so no server is needed. An unknown item id returns 404, and the agent tries again with a valid id.
- **Under the hood** (bottom left) shows the live events: what the customer said, each tool call with its arguments, voice-to-voice latency and first-byte times.
- GSAP 3.13 runs the motion. The page still works without it, and it skips motion for visitors who prefer reduced motion.

| Tool the agent calls | What the screen does |
| --- | --- |
| `add_item` | Adds an order line and shows the item with its options |
| `update_item` | Changes size, flavor, extras, combo, combo drink or quantity |
| `remove_item` | Removes the line |
| `show_menu` | Shows a menu category |
| `safe_calculator` | Highlights the total before the read-back |
| `place_order` | Shows the order number. The agent says goodbye and the call ends |
| `end_conversation` | Ends without an order |

## Updating

- **Agent behaviour:** change and publish the agent in DeepTalk. The page uses the published version on the next call.
- **Menu:** edit `menu.json`, run `python3 scripts/build_api.py`, and commit. Then paste `agent/menu-prompt.md` into the MENU section of the agent's global prompt and publish the agent.
- **Embed token:** if the widget token is regenerated, update `EMBED_TOKEN` in `assets/js/kiosk.js`. The widget's Allowed Domains must include `aistra-labs.github.io`.
- **Testing without a call:** open the page with `?debug=1`. `window.BunzoKiosk.event({type, payload})` replays a live event.

## Notes

- Bunzo, its menu and its prices are made up.
- Icons: Microsoft Fluent Emoji, MIT License. See `THIRD-PARTY-NOTICES.md`.
