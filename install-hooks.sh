#!/bin/bash
set -e

HOOKS_SRC="$(dirname "$0")/.githooks"
HOOKS_DST="$(dirname "$0")/.git/hooks"

echo "Instalando hooks desde ${HOOKS_SRC} a ${HOOKS_DST}..."

for hook in "${HOOKS_SRC}"/*; do
  name="$(basename "${hook}")"
  cp "${hook}" "${HOOKS_DST}/${name}"
  chmod +x "${HOOKS_DST}/${name}"
  echo "  ✔ ${name}"
done

echo "✅ Hooks instalados correctamente"
