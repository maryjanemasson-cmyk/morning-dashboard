#!/usr/bin/env python3
"""Bake Firebase wardrobeCrops into ~/morning-dashboard-site/wardrobe-thumbs/."""
import base64
import json
import os
import sys
import urllib.request

FIREBASE = "https://morning-dashboard-4c62b-default-rtdb.firebaseio.com/wardrobeCrops.json"
THUMBS_DIR = os.path.expanduser("~/morning-dashboard-site/wardrobe-thumbs")
IMAGES_DIR = os.path.expanduser("~/morning-dashboard-site/wardrobe-images")

print(f"Fetching crops from Firebase…")
with urllib.request.urlopen(FIREBASE) as resp:
    crops = json.load(resp)

if not crops:
    print("No crops in Firebase. Nothing to bake.")
    sys.exit(0)

print(f"Found {len(crops)} crops.")

baked = 0
skipped_no_data = 0
errors = []

for key, value in crops.items():
    # key is like "s20_014_png" → restore to "s20_014.png"
    parts = key.rsplit("_", 1)
    if len(parts) != 2:
        errors.append(f"{key}: bad key format")
        continue
    base, ext = parts
    filename = f"{base}.{ext}"
    out_path = os.path.join(THUMBS_DIR, filename)

    if not isinstance(value, str) or not value.startswith("data:"):
        skipped_no_data += 1
        continue

    # Strip data URL prefix
    try:
        header, b64 = value.split(",", 1)
        data = base64.b64decode(b64)
    except Exception as e:
        errors.append(f"{key}: decode failed - {e}")
        continue

    try:
        with open(out_path, "wb") as f:
            f.write(data)
        baked += 1
    except Exception as e:
        errors.append(f"{key}: write failed - {e}")

print(f"\nBaked: {baked}")
print(f"Skipped (no data): {skipped_no_data}")
print(f"Errors: {len(errors)}")
for e in errors[:10]:
    print(f"  {e}")
