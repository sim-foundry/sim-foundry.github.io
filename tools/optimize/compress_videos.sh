#!/usr/bin/env bash
# Re-encode MP4s in place for web delivery (Balanced quality):
#   - H.264 (libx264) CRF 28, preset slow  — broad browser support
#   - cap height to 720p, never upscale, keep aspect (even dimensions)
#   - strip audio (all page videos are muted loops)
#   - yuv420p + faststart for progressive web playback
#
# Idempotent: files already carrying our metadata marker are skipped.
#
# Usage:  tools/optimize/compress_videos.sh <dir-or-file> [<dir-or-file> ...]
set -euo pipefail

MARKER="sf-opt-crf28"
CRF="${CRF:-28}"
MAXH="${MAXH:-720}"

has_marker() {
  ffprobe -v error -show_entries format_tags=comment -of default=nw=1:nk=1 "$1" 2>/dev/null | grep -q "$MARKER"
}

total_before=0; total_after=0; count=0; skipped=0

process() {
  local f="$1"
  if has_marker "$f"; then skipped=$((skipped+1)); return; fi
  local before; before=$(stat -c%s "$f")
  local tmp; tmp="$(mktemp --suffix=.mp4)"
  # Downscale only when taller than MAXH; keep width even.
  local vf="scale='if(gt(ih,$MAXH),trunc(iw*$MAXH/ih/2)*2,iw)':'min(ih,$MAXH)'"
  if ffmpeg -y -nostdin -i "$f" \
        -vf "$vf" \
        -c:v libx264 -crf "$CRF" -preset "${PRESET:-medium}" -pix_fmt yuv420p \
        -an -movflags +faststart \
        -metadata comment="$MARKER" \
        "$tmp" >/dev/null 2>&1 && [ -s "$tmp" ]; then
    local after; after=$(stat -c%s "$tmp")
    # Guard: never let a re-encode make a file bigger (already-lean clips).
    if [ "$after" -lt "$before" ]; then
      mv "$tmp" "$f"
    else
      ffmpeg -y -nostdin -i "$f" -c copy -an -movflags +faststart \
        -metadata comment="$MARKER" "$tmp" >/dev/null 2>&1 && mv "$tmp" "$f" || rm -f "$tmp"
      after=$(stat -c%s "$f")
    fi
    total_before=$((total_before+before)); total_after=$((total_after+after)); count=$((count+1))
    printf "  %-50s %6.1fMB -> %6.1fMB\n" "$(basename "$f")" \
      "$(echo "$before/1048576"|bc -l)" "$(echo "$after/1048576"|bc -l)"
  else
    rm -f "$tmp"; echo "  !! FAILED: $f" >&2
  fi
}

for target in "$@"; do
  if [ -d "$target" ]; then
    while IFS= read -r -d '' f; do process "$f"; done < <(find "$target" -name '*.mp4' -print0)
  elif [ -f "$target" ]; then process "$target"; fi
done

echo "------------------------------------------------------------"
printf "encoded %d files (skipped %d already-optimized)\n" "$count" "$skipped"
[ "$total_before" -gt 0 ] && printf "total: %.1fMB -> %.1fMB  (%.1fx smaller)\n" \
  "$(echo "$total_before/1048576"|bc -l)" "$(echo "$total_after/1048576"|bc -l)" \
  "$(echo "$total_before/$total_after"|bc -l)"
