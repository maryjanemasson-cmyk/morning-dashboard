#!/usr/bin/env python3
"""
Extract base64 data URLs embedded in Firebase outfitEdits.layout[].file
into real image files in outfit-images/, then save the slimmed-down
outfitEdits back to Firebase.

This dramatically shrinks outfitEdits (was 15MB → ~100KB) so the wardrobe
page's "loading outfit links..." finishes in milliseconds instead of minutes.
"""
import base64
import hashlib
import json
import os
import sys
import urllib.request

FIREBASE_BASE = "https://morning-dashboard-4c62b-default-rtdb.firebaseio.com"
NODE = "outfitEdits"
OUT_DIR = os.path.expanduser("~/morning-dashboard-site/outfit-images")

print(f"Fetching {NODE} from Firebase…")
with urllib.request.urlopen(f"{FIREBASE_BASE}/{NODE}.json") as resp:
    edits = json.load(resp)

if not edits:
    print(f"No {NODE} data. Nothing to do.")
    sys.exit(0)

original_size = len(json.dumps(edits))
print(f"Loaded: {original_size:,} bytes")

EXT_MAP = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
}

baked = 0
deduped = 0
errors = []

# Walk all pieces in all edits
items = edits.items() if isinstance(edits, dict) else enumerate(edits)
for slide_key, edit in items:
    if not isinstance(edit, dict) or "layout" not in edit:
        continue
    layout = edit["layout"]
    if not isinstance(layout, list):
        continue
    for piece in layout:
        f = piece.get("file", "")
        if not (isinstance(f, str) and f.startswith("data:")):
            continue
        # Parse data URL
        try:
            header, b64 = f.split(",", 1)
            mime = header.split(";")[0].replace("data:", "")
            ext = EXT_MAP.get(mime, "png")
            data = base64.b64decode(b64)
        except Exception as e:
            errors.append(f"slide {slide_key}: parse error - {e}")
            continue

        sha1 = hashlib.sha1(data).hexdigest()[:16]
        filename = f"piece_{sha1}.{ext}"
        out_path = os.path.join(OUT_DIR, filename)

        if os.path.exists(out_path):
            deduped += 1
        else:
            try:
                with open(out_path, "wb") as wf:
                    wf.write(data)
                baked += 1
            except Exception as e:
                errors.append(f"slide {slide_key}: write error - {e}")
                continue

        # Update piece in place: file path becomes the filename (IMG_PATH adds outfit-images/)
        piece["file"] = filename

new_size = len(json.dumps(edits))
print(f"\nBaked new files: {baked}")
print(f"Deduped (file already existed): {deduped}")
print(f"Errors: {len(errors)}")
for e in errors[:10]:
    print(f"  {e}")
print(f"\nNew outfitEdits size: {new_size:,} bytes (was {original_size:,})")
print(f"Reduction: {(1 - new_size/original_size) * 100:.1f}%")

if baked + deduped == 0:
    print("Nothing changed. Skipping Firebase update.")
    sys.exit(0)

if "--dry-run" in sys.argv:
    print("\n--dry-run: skipping Firebase upload.")
    sys.exit(0)

# Push slimmed-down edits back to Firebase via PUT (full replace)
print(f"\nWriting slimmed-down {NODE} back to Firebase…")
body = json.dumps(edits).encode()
req = urllib.request.Request(
    f"{FIREBASE_BASE}/{NODE}.json",
    data=body,
    method="PUT",
    headers={"Content-Type": "application/json"},
)
with urllib.request.urlopen(req) as resp:
    print(f"Firebase responded: HTTP {resp.status}")
print("Done.")
