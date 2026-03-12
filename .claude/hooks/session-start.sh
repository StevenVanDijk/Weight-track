#!/bin/bash
set -euo pipefail

# Only run in remote (Claude Code on the web) environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

echo '{"async": true, "asyncTimeout": 300000}'

REPO_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

echo "Installing gh CLI..."
if ! command -v gh &>/dev/null; then
  # Download and install gh from GitHub releases (no apt/DNS required for pre-cached binary)
  GH_VERSION="2.45.0"
  GH_DEB_URL="https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.deb"
  TMP_DEB="/tmp/gh_${GH_VERSION}_linux_amd64.deb"
  if [ ! -f "$TMP_DEB" ]; then
    curl -fsSL "$GH_DEB_URL" -o "$TMP_DEB"
  fi
  sudo dpkg -i "$TMP_DEB"
fi

echo "Installing npm dependencies..."
cd "$REPO_DIR"
npm install
