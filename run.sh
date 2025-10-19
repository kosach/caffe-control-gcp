#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FUNCTIONS_DIR="${ROOT_DIR}/functions/nodejs"
LOCAL_RUN_SCRIPT="${ROOT_DIR}/scripts/local-run.sh"

command="${1:-}"
if [[ $# -gt 0 ]]; then
  shift
fi

show_help() {
  cat <<'EOF'
Usage: ./run.sh <command> [options]

Commands:
  tests          Run Jest test suite
  build          Create tsup bundle
  local [name]   Launch local Functions Framework (default: webhook)
  diff [-f]      Show modified/new files with contents, optionally save to diff.txt

Examples:
  ./run.sh tests
  ./run.sh build
  ./run.sh local getAllTransactions
  ./run.sh diff -f
EOF
}

run_tests() {
  (cd "${FUNCTIONS_DIR}" && npm test "$@")
}

run_build() {
  (cd "${FUNCTIONS_DIR}" && npm run bundle "$@")
}

run_local() {
  if [[ ! -x "${LOCAL_RUN_SCRIPT}" ]]; then
    echo "❌ Local run script not found or not executable: ${LOCAL_RUN_SCRIPT}" >&2
    exit 1
  fi

  "${LOCAL_RUN_SCRIPT}" "$@"
}

generate_diff_output() {
  echo "📝 Modified and New Files:"
  
  local all_files=()
  
  # Staged files (готові до коміту)
  while IFS= read -r file; do
    [[ -n "${file}" ]] && all_files+=("${file}")
  done < <(git diff --cached --name-only 2>/dev/null || true)
  
  # Modified but not staged (змінені але не додані)
  while IFS= read -r file; do
    [[ -n "${file}" ]] && all_files+=("${file}")
  done < <(git diff --name-only 2>/dev/null || true)
  
  # Untracked files (нові файли)
  while IFS= read -r file; do
    [[ -n "${file}" ]] && all_files+=("${file}")
  done < <(git ls-files --others --exclude-standard 2>/dev/null || true)
  
  # Remove duplicates and sort
  local unique_files
  unique_files=($(printf '%s\n' "${all_files[@]}" | sort -u))
  
  if [[ ${#unique_files[@]} -eq 0 ]]; then
    echo "(no modified or new files)"
    return
  fi

  for file in "${unique_files[@]}"; do
    # Skip diff.txt to avoid recursion
    [[ "${file}" == "diff.txt" ]] && continue
    
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📄 File: ${file}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    if [[ -f "${file}" ]]; then
      cat "${file}"
    else
      echo "(file not found)"
    fi
    echo ""
  done
}

run_diff() {
  local save_to_file=false

  while [[ $# -gt 0 ]]; do
    case "$1" in
      -f)
        save_to_file=true
        shift
        ;;
      *)
        echo "Unknown diff option: $1" >&2
        return 1
        ;;
    esac
  done

  if [[ "${save_to_file}" == true ]]; then
    local diff_file="${ROOT_DIR}/diff.txt"
    generate_diff_output > "${diff_file}"
    echo "💾 Diff output saved to ${diff_file}"
    echo "📊 Files included in diff:"
    cat "${diff_file}" | grep "📄 File:" | sed 's/📄 File: /  - /'
  else
    generate_diff_output
  fi
}

case "${command}" in
  tests)
    run_tests "$@"
    ;;
  build)
    run_build "$@"
    ;;
  local)
    run_local "$@"
    ;;
  diff)
    run_diff "$@"
    ;;
  ""|-h|--help)
    show_help
    ;;
  *)
    echo "Unknown command: ${command}" >&2
    show_help
    exit 1
    ;;
esac
