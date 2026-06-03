#!/usr/bin/env bash
# Compress GLB meshes in place: meshopt geometry (EXT_meshopt_compression +
# KHR_mesh_quantization) + KTX2/Basis textures (KHR_texture_basisu).
#
# Requires the NATIVE gltfpack build — the npm package is compiled without
# BasisU, so texture compression silently fails there. We fetch the native
# Linux binary into tools/optimize/bin/ (gitignored) if not already present.
#
# Runtime support needed in viewers.js:
#   - MeshoptDecoder      (already wired) for EXT_meshopt_compression
#   - KTX2Loader + basis transcoder for KHR_texture_basisu
#
# Usage:  tools/optimize/compress_glbs.sh <dir-or-glb> [<dir-or-glb> ...]
# Files already carrying EXT_meshopt_compression are skipped (idempotent).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$HERE/bin"
GLTFPACK="${GLTFPACK:-$BIN_DIR/gltfpack}"
GLTFPACK_URL="https://github.com/zeux/meshoptimizer/releases/download/v0.20/gltfpack-ubuntu.zip"

if [ ! -x "$GLTFPACK" ]; then
  echo "→ fetching native gltfpack into $BIN_DIR"
  mkdir -p "$BIN_DIR"
  curl -sL -o "$BIN_DIR/gltfpack.zip" "$GLTFPACK_URL"
  (cd "$BIN_DIR" && unzip -o gltfpack.zip >/dev/null && rm -f gltfpack.zip && chmod +x gltfpack)
fi

is_meshopt() {
  python3 - "$1" <<'PY'
import struct, json, sys
try:
    d = open(sys.argv[1], 'rb').read()
    jl = struct.unpack('<I', d[12:16])[0]
    js = json.loads(d[20:20+jl])
    sys.exit(0 if 'EXT_meshopt_compression' in (js.get('extensionsUsed') or []) else 1)
except Exception:
    sys.exit(1)
PY
}

total_before=0
total_after=0
count=0
skipped=0

process() {
  local f="$1"
  if is_meshopt "$f"; then
    skipped=$((skipped+1)); return
  fi
  local before; before=$(stat -c%s "$f")
  local tmp; tmp="$(mktemp --suffix=.glb)"
  # -cc: aggressive meshopt; -tc: KTX2/ETC1S textures (no-op if mesh has none)
  if "$GLTFPACK" -i "$f" -o "$tmp" -cc -tc >/dev/null 2>&1 && [ -s "$tmp" ]; then
    local after; after=$(stat -c%s "$tmp")
    mv "$tmp" "$f"
    total_before=$((total_before+before))
    total_after=$((total_after+after))
    count=$((count+1))
    printf "  %-55s %5.1fMB -> %5.1fMB\n" "$(basename "$f")" "$(echo "$before/1048576"|bc -l)" "$(echo "$after/1048576"|bc -l)"
  else
    rm -f "$tmp"
    echo "  !! FAILED: $f" >&2
  fi
}

for target in "$@"; do
  if [ -d "$target" ]; then
    while IFS= read -r -d '' f; do process "$f"; done < <(find "$target" -name '*.glb' -print0)
  elif [ -f "$target" ]; then
    process "$target"
  fi
done

echo "------------------------------------------------------------"
printf "compressed %d files (skipped %d already-meshopt)\n" "$count" "$skipped"
if [ "$total_before" -gt 0 ]; then
  printf "total: %.1fMB -> %.1fMB  (%.1fx smaller)\n" \
    "$(echo "$total_before/1048576"|bc -l)" \
    "$(echo "$total_after/1048576"|bc -l)" \
    "$(echo "$total_before/$total_after"|bc -l)"
fi
