#!/bin/bash
# Verify src/sim/ does not import from UI/sound/persistence modules.
matches=$(grep -rn "from ['\"]@/stores/\|from ['\"]@/components/\|from ['\"]@/router/\|from ['\"]@/sound/" src/sim/ 2>/dev/null || true)
if [ -n "$matches" ]; then
  echo "ERROR: src/sim/ must not import from stores, components, router, or sound" >&2
  echo "$matches" >&2
  exit 1
fi
