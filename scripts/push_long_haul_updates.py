#!/usr/bin/env python3
"""
Push Momondo long-haul deals to the Cloudflare dashboard.

Default source file:
  /home/ubuntu/downloads/Long Haul Flights/Momondo Results/momondo-check-output.json

Example:
  python3 scripts/push_long_haul_updates.py \
    --dashboard-url "https://cloudflare-dashboard-58x.pages.dev"
"""

import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request


DEFAULT_SOURCE = "/home/ubuntu/downloads/Long Haul Flights/Momondo Results/momondo-check-output.json"


def parse_args():
  parser = argparse.ArgumentParser()
  parser.add_argument(
    "--dashboard-url",
    default=os.environ.get("DASHBOARD_URL", "").strip(),
    help="Dashboard base URL, e.g. https://cloudflare-dashboard-58x.pages.dev",
  )
  parser.add_argument(
    "--source-file",
    default=os.environ.get("LONG_HAUL_SOURCE_FILE", DEFAULT_SOURCE),
    help="Path to momondo-check-output.json",
  )
  parser.add_argument(
    "--state-file",
    default=os.environ.get("LONG_HAUL_STATE_FILE", ""),
    help="State file path (default: <source dir>/.long_haul_push_state.json)",
  )
  parser.add_argument(
    "--dry-run",
    action="store_true",
    help="Parse and print payload without sending",
  )
  return parser.parse_args()


def read_json(path):
  with open(path, "r", encoding="utf-8") as handle:
    return json.load(handle)


def file_hash(path):
  digest = hashlib.sha1()
  with open(path, "rb") as handle:
    for chunk in iter(lambda: handle.read(65536), b""):
      digest.update(chunk)
  return digest.hexdigest()


def load_state(path):
  if not os.path.isfile(path):
    return {}
  try:
    return read_json(path)
  except Exception:
    return {}


def save_state(path, state):
  os.makedirs(os.path.dirname(path), exist_ok=True)
  with open(path, "w", encoding="utf-8") as handle:
    json.dump(state, handle, ensure_ascii=False, indent=2)


def normalize_deals(raw_items):
  deals = []
  skipped_empty_cards = 0
  skipped_invalid = 0

  for item in raw_items:
    cards = item.get("cards")
    if not isinstance(cards, list) or not cards:
      skipped_empty_cards += 1
      continue

    first_card = next((card for card in cards if isinstance(card, dict) and isinstance(card.get("price_eur"), (int, float))), None)
    if not first_card:
      skipped_empty_cards += 1
      continue

    origin = str(item.get("origin") or "").strip().upper()
    destination = str(item.get("destination") or "").strip().upper()
    outbound_date = str(item.get("outbound_date") or "").strip()
    inbound_date = str(item.get("inbound_date") or "").strip()
    momondo_url = str(item.get("momondo_url") or "").strip()

    if not origin or not destination or not outbound_date or not inbound_date or not momondo_url:
      skipped_invalid += 1
      continue

    deals.append(
      {
        "origin": origin,
        "destination": destination,
        "outbound_date": outbound_date,
        "inbound_date": inbound_date,
        "price_eur": float(first_card["price_eur"]),
        "momondo_url": momondo_url,
        "airlines": [str(name) for name in first_card.get("airlines", []) if str(name).strip()],
      }
    )

  return deals, skipped_empty_cards, skipped_invalid


def post_update(base_url, payload):
  url = base_url.rstrip("/") + "/api/update-long-haul"
  body = json.dumps(payload).encode("utf-8")
  req = urllib.request.Request(
    url,
    data=body,
    method="POST",
    headers={
      "content-type": "application/json",
      "accept": "application/json,text/plain,*/*",
      "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    },
  )
  with urllib.request.urlopen(req, timeout=30) as response:
    return response.status, response.read().decode("utf-8", errors="replace")


def main():
  args = parse_args()
  if not args.dashboard_url:
    print("error: --dashboard-url (or DASHBOARD_URL env) is required", file=sys.stderr)
    return 2

  source_file = os.path.abspath(args.source_file)
  if not os.path.isfile(source_file):
    print(f"error: source file not found: {source_file}", file=sys.stderr)
    return 2

  state_file = args.state_file or os.path.join(os.path.dirname(source_file), ".long_haul_push_state.json")
  state = load_state(state_file)
  digest = file_hash(source_file)
  if state.get("source_hash") == digest:
    print("No changes detected in momondo-check-output.json")
    return 0

  raw = read_json(source_file)
  if not isinstance(raw, list):
    print("error: source JSON must be an array", file=sys.stderr)
    return 2

  deals, skipped_empty_cards, skipped_invalid = normalize_deals(raw)
  payload = {"deals": deals}

  if args.dry_run:
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"Prepared {len(deals)} deals, skipped {skipped_empty_cards} empty-card entries, skipped {skipped_invalid} invalid entries")
    return 0

  try:
    status, text = post_update(args.dashboard_url, payload)
  except urllib.error.HTTPError as exc:
    body = exc.read().decode("utf-8", errors="replace")
    print(f"HTTP {exc.code}: {body}", file=sys.stderr)
    return 1
  except Exception as exc:
    print(f"request failed: {exc}", file=sys.stderr)
    return 1

  if status < 200 or status >= 300:
    print(f"unexpected status {status}: {text}", file=sys.stderr)
    return 1

  state["source_hash"] = digest
  save_state(state_file, state)

  print(
    f"Updated long-haul deals from {source_file}. "
    f"Sent {len(deals)} deals, skipped {skipped_empty_cards} empty-card entries, skipped {skipped_invalid} invalid entries. "
    f"API response: {text}"
  )
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
