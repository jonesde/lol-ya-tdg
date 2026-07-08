#!/bin/bash
# Verify src/sim/ does not import from UI/sound/persistence modules.
# Type-only imports (import type) are permitted through Phase 6.
allMatches=$(grep -rn "from ['\"]@/stores/\|from ['\"]@/components/\|from ['\"]@/router/\|from ['\"]@/sound/" src/sim/ 2>/dev/null || true)
if [ -z "$allMatches" ]; then
  exit 0
fi
matches=$(echo "$allMatches" | grep -v "import type" || true)
if [ -n "$matches" ]; then
  echo "ERROR: src/sim/ must not import from stores, components, router, or sound" >&2
  echo "(type-only imports are permitted through Phase 6)" >&2
  echo "$matches" >&2
  exit 1
fi
