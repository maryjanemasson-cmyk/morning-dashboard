#!/usr/bin/env python3
"""Bake wardrobeCustomItems data URLs to disk, slimming the Firebase node.

Custom-uploaded wardrobe items store the image as a base64 data URL inside
Firebase under wardrobeCustomItems/{id}.image. With ~7 items totaling 1 MB,
the wardrobe page paid a 6 s fetch on every load.

This script writes each image to wardrobe-thumbs/{id}.{ext}, sets
data.file = "{id}.{ext}", and removes data.image. The wardrobe page's
renderer already falls back to wardrobe-thumbs/{file} when _customImage
is absent, so no code change is needed.
"""
import base64
import json
import os
import sys
import urllib.request

FIREBASE = "https://morning-dashboard-4c62b-default-rtdb.firebaseio.com/wardrobeCustomItems.json"
THUMBS = os.path.expanduser("~/morning-dashboard-site/wardrobe-thumbs")

EXT = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}

with urllib.request.urlopen(FIREBASE) as r:
    custom = json.load(r) or {}

print(f"Found {len(custom)} custom items.")

baked = 0
already = 0
for cid, data in custom.items():
    if not isinstance(data, dict):
        continue
    img = data.get("image", "")
    if not (isinstance(img, str) and img.startswith("data:")):
        already += 1
        continue
    mime = img.split(";")[0].replace("data:", "")
    ext = EXT.get(mime, "png")
    filename = f"{cid}.{ext}"
    out_path = os.path.join(THUMBS, filename)
    try:
        _, b64 = img.split(",", 1)
        with open(out_path, "wb") as f:
            f.write(base64.b64decode(b64))
    except Exception as e:
        print(f"  {cid}: write failed - {e}")
        continue
    # Update entry in place: drop image, set file
    new_entry = {k: v for k, v in data.items() if k != "image"}
    new_entry["file"] = filename
    custom[cid] = new_entry
    baked += 1
    print(f"  baked {cid} → {filename} ({os.path.getsize(out_path):,} bytes)")

print(f"\nBaked: {baked}, already-baked: {already}")
new_size = len(json.dumps(custom))
print(f"New wardrobeCustomItems size: {new_size:,} bytes")

if baked == 0:
    print("Nothing to update.")
    sys.exit(0)

if "--dry-run" in sys.argv:
    print("\n--dry-run: skipping Firebase write.")
    sys.exit(0)

body = json.dumps(custom).encode()
req = urllib.request.Request(FIREBASE, data=body, method="PUT",
                              headers={"Content-Type": "application/json"})
with urllib.request.urlopen(req) as resp:
    print(f"Firebase: HTTP {resp.status}")
