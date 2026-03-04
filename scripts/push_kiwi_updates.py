#!/usr/bin/env python3
"""
Scan a folder for *.json Kiwi outputs and push prices to Cloudflare dashboard.

Example:
  python3 scripts/push_kiwi_updates.py \
    --dashboard-url "https://cloudflare-dashboard-58x.pages.dev" \
    --folder "/home/ubuntu/Kiwi Prices Updates"
"""

import argparse
import glob
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def parse_args():
  parser = argparse.ArgumentParser()
  parser.add_argument(
    "--dashboard-url",
    default=os.environ.get("DASHBOARD_URL", "").strip(),
    help="Dashboard base URL, e.g. https://cloudflare-dashboard-58x.pages.dev",
  )
  parser.add_argument(
    "--folder",
    default=os.environ.get("KIWI_UPDATES_FOLDER", os.path.join(BASE_DIR, "Kiwi Prices Updates")),
    help='Folder containing files like "TIA.json"',
  )
  parser.add_argument(
    "--from-code",
    default=os.environ.get("FROM_CODE", "BUH"),
    help="Origin code sent to API (default: BUH)",
  )
  parser.add_argument(
    "--state-file",
    default="",
    help="State file path (default: <folder>/.push_state.json)",
  )
  parser.add_argument(
    "--dry-run",
    action="store_true",
    help="Parse and print payload without sending",
  )
  return parser.parse_args()


def read_json(path):
  with open(path, "r", encoding="utf-8") as f:
    return json.load(f)


def file_hash(path):
  h = hashlib.sha1()
  with open(path, "rb") as f:
    for chunk in iter(lambda: f.read(65536), b""):
      h.update(chunk)
  return h.hexdigest()


def to_bool(value):
  if isinstance(value, bool):
    return value
  s = str(value or "").strip().lower()
  return s in ("1", "true", "yes", "y")


def load_state(path):
  if not os.path.isfile(path):
    return {}
  try:
    return read_json(path)
  except Exception:
    return {}


def save_state(path, state):
  os.makedirs(os.path.dirname(path), exist_ok=True)
  with open(path, "w", encoding="utf-8") as f:
    json.dump(state, f, ensure_ascii=False, indent=2)


def build_results(folder, state):
  results = []
  sent_files = []
  skipped = 0

  pattern = os.path.join(folder, "*.json")
  files = sorted(glob.glob(pattern))
  print(f"[DEBUG] Scanning folder: {folder}")
  print(f"[DEBUG] Found JSON files: {len(files)}")

  for path in files:
    name = os.path.basename(path)
    digest = file_hash(path)
    print(f"[DEBUG] Checking file: {name}")
    if state.get(name) == digest:
      skipped += 1
      print(f"[DEBUG]  - unchanged (hash match), skipping")
      continue

    try:
      data = read_json(path)
    except Exception as e:
      print(f"skip {name}: invalid JSON ({e})", file=sys.stderr)
      continue

    print(f"[DEBUG]  - top-level keys: {list(data.keys()) if isinstance(data, dict) else type(data)}")

    code_from_file = os.path.splitext(name)[0].upper()
    code = str(data.get("iata_city_code") or code_from_file).upper()
    if code != code_from_file:
      print(
        f"skip {name}: iata_city_code '{code}' does not match filename '{code_from_file}'",
        file=sys.stderr,
      )
      continue

    try:
      price = float(data["price_eur"])
      print(f"[DEBUG]  - parsed price_eur={price}")
    except Exception:
      print(f"skip {name}: missing or invalid price_eur", file=sys.stderr)
      continue

    results.append(
      {
        "to": code,
        "price": price,
        "dep": data.get("date"),
        "direct": to_bool(data.get("direct")),
        "link": data.get("kiwi_link"),
      }
    )
    sent_files.append((name, digest))

  return results, sent_files, skipped


def post_update(base_url, payload):
  url = base_url.rstrip("/") + "/api/update"
  body = json.dumps(payload).encode("utf-8")
  print(f"[DEBUG] POST URL: {url}")
  print(f"[DEBUG] Payload results count: {len(payload.get('results', []))}")
  print(f"[DEBUG] Payload preview: {json.dumps(payload, ensure_ascii=False)[:500]}")
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
  with urllib.request.urlopen(req, timeout=30) as res:
    text = res.read().decode("utf-8", errors="replace")
    print(f"[DEBUG] Response status: {res.status}")
    print(f"[DEBUG] Response body: {text[:500]}")
    return res.status, text


def main():
  args = parse_args()
  print(f"[DEBUG] dashboard_url={args.dashboard_url}")
  print(f"[DEBUG] folder={args.folder}")
  print(f"[DEBUG] from_code={args.from_code}")
  if not args.dashboard_url:
    print("error: --dashboard-url (or DASHBOARD_URL env) is required", file=sys.stderr)
    return 2

  folder = os.path.abspath(args.folder)
  if not os.path.isdir(folder):
    print(f"error: folder not found: {folder}", file=sys.stderr)
    return 2

  state_file = args.state_file or os.path.join(folder, ".push_state.json")
  state = load_state(state_file)

  results, sent_files, skipped = build_results(folder, state)
  if not results:
    print(f"No new valid JSON files to send. Skipped unchanged: {skipped}")
    return 0

  payload = {
    "from_code": args.from_code.upper(),
    "currency": "EUR",
    "results": results,
  }

  if args.dry_run:
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"Dry run only. Files prepared: {len(sent_files)}, unchanged skipped: {skipped}")
    return 0

  try:
    status, text = post_update(args.dashboard_url, payload)
  except urllib.error.HTTPError as e:
    body = e.read().decode("utf-8", errors="replace")
    print(f"HTTP {e.code}: {body}", file=sys.stderr)
    return 1
  except Exception as e:
    print(f"request failed: {e}", file=sys.stderr)
    return 1

  if status < 200 or status >= 300:
    print(f"unexpected status {status}: {text}", file=sys.stderr)
    return 1

  for name, digest in sent_files:
    state[name] = digest
  save_state(state_file, state)

  print(f"Updated dashboard from {len(sent_files)} file(s). API response: {text}")
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
