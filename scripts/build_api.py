"""Build the static tool responses and the agent's menu text from menu.json.

    python3 scripts/build_api.py

Writes:
  api/ok.json                 reply for update_item and remove_item
  api/items/<item_id>.json    reply for add_item (an unknown id is a 404)
  api/menu/<category>.json    reply for show_menu (plus all.json)
  agent/menu-prompt.md        the MENU section of the agent's global prompt

Run it after every menu change, then paste agent/menu-prompt.md into the agent.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MENU = json.loads((ROOT / "menu.json").read_text())


def money(value):
    return f"${value:.2f}"


def item_payload(item):
    payload = {"id": item["id"], "name": item["name"], "category": item["category"]}
    if item.get("sizes"):
        payload["sizes"] = {s["id"]: s["price"] for s in item["sizes"]}
    else:
        payload["price"] = item["price"]
    if item.get("choice"):
        choice = MENU["choice_sets"][item["choice"]]
        payload["choice"] = {"label": choice["label"], "options": [o["id"] for o in choice["options"]]}
    if item["modifiers"]:
        payload["modifiers"] = {m: MENU["modifiers"][m]["price"] for m in item["modifiers"]}
    payload["combo_available"] = item["combo"]
    return payload


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False) + "\n")


def build_api():
    api = ROOT / "api"
    write(api / "ok.json", {"status": "ok", "screen": "updated"})
    for item in MENU["items"]:
        write(api / "items" / f"{item['id']}.json", {"status": "ok", "screen": "item shown", "item": item_payload(item)})
    for category in MENU["categories"] + [{"id": "all", "name": "Full menu"}]:
        items = [i for i in MENU["items"] if category["id"] in ("all", i["category"])]
        write(
            api / "menu" / f"{category['id']}.json",
            {"status": "ok", "screen": f"{category['name']} shown", "items": [i["id"] for i in items]},
        )


def item_line(item):
    if item.get("sizes"):
        price = ", ".join(f"{s['id']} {money(s['price'])}" for s in item["sizes"])
    else:
        price = money(item["price"])
    parts = [f"- {item['id']}: {item['name']}. {price}."]
    if item.get("choice"):
        set_ = MENU["choice_sets"][item["choice"]]
        parts.append(f"Needs choice ({set_['label'].lower()}): " + ", ".join(o["id"] for o in set_["options"]) + ".")
    if item["modifiers"]:
        parts.append("Modifiers: " + ", ".join(item["modifiers"]) + ".")
    parts.append("Combo: yes." if item["combo"] else "Combo: no.")
    parts.append(f"About: {item['description']} {item['calories']} cal.")
    return " ".join(parts)


def build_prompt():
    lines = ["# MENU", "", f"All prices are in US dollars and include tax. {MENU['brand']['name']} sells only these items.", ""]
    for category in MENU["categories"]:
        lines.append(f"## {category['name']} (category id: {category['id']})")
        lines += [item_line(i) for i in MENU["items"] if i["category"] == category["id"]]
        lines.append("")
    lines.append("## Choice option names")
    for set_id, set_ in MENU["choice_sets"].items():
        lines.append(f"- {set_id}: " + ", ".join(f"{o['id']} = {o['name']}" for o in set_["options"]))
    lines.append("")
    lines.append("## Modifiers (price added per item)")
    for mod_id, mod in MENU["modifiers"].items():
        lines.append(f"- {mod_id}: {mod['name']}, " + ("free" if mod["price"] == 0 else f"+{money(mod['price'])}"))
    lines.append("")
    combo = MENU["combo"]
    lines.append("## Combos")
    lines.append(
        f"- regular: +{money(combo['regular']['price'])}, adds {combo['regular']['includes']}."
    )
    lines.append(f"- large: +{money(combo['large']['price'])}, adds {combo['large']['includes']}.")
    lines.append("- Every combo needs a combo_drink, one of the fountain_flavors ids.")
    lines.append("")
    lines.append("## Line price")
    lines.append(
        "(size price or item price) + (each modifier price) + (combo price), then times quantity. "
        "A choice (flavor, dip) and a combo_drink never change the price."
    )
    path = ROOT / "agent" / "menu-prompt.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    build_api()
    build_prompt()
    print(f"built {len(MENU['items'])} items, {len(MENU['categories'])} categories")
