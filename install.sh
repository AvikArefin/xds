#!/bin/sh
# XDS installer for macOS and Linux:
#   curl -fsSL https://raw.githubusercontent.com/AvikArefin/xds/main/install.sh | sh
# Installs into ~/xds (set XDS_DIR to change it). Safe to run again: it updates in place.
# Brings its own tools: uv (which brings Python) and a private Node.js inside the xds folder,
# so nothing else needs to be installed first and an existing Node is left alone.
set -eu

REPO_URL="https://github.com/AvikArefin/xds"
DIR="${XDS_DIR:-$HOME/xds}"
NODE_MAJOR=22

say() { printf '\033[1m==> %s\033[0m\n' "$1"; }
die() { printf 'error: %s\n' "$1" >&2; exit 1; }
has() { command -v "$1" >/dev/null 2>&1; }

has curl || die "curl is required"
has tar || die "tar is required"

# 1. uv (and through it, Python 3.12)
if ! has uv; then
  say "Installing uv"
  curl -LsSf https://astral.sh/uv/install.sh | sh
  PATH="$HOME/.local/bin:$PATH"
  has uv || die "uv installed but not found on PATH; open a new terminal and run this again"
fi

# 2. The code: git if available, otherwise the zip from GitHub
if [ -d "$DIR/.git" ]; then
  say "Updating $DIR"
  git -C "$DIR" pull --ff-only
elif [ -f "$DIR/pyproject.toml" ]; then
  say "Using the existing copy in $DIR"
elif has git; then
  say "Downloading XDS into $DIR"
  git clone --depth 1 "$REPO_URL.git" "$DIR"
else
  say "Downloading XDS into $DIR (no git found, using the zip)"
  mkdir -p "$DIR"
  curl -fsSL "$REPO_URL/archive/refs/heads/main.tar.gz" | tar -xz -C "$DIR" --strip-components 1
fi
cd "$DIR"

# 3. Node.js: the one on PATH if it is new enough, otherwise a private copy in .tools/node
node_ok() { has node && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 20 ]; }
if ! node_ok; then
  case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; *) die "unsupported system: $(uname -s)" ;; esac
  case "$(uname -m)" in x86_64|amd64) arch=x64 ;; arm64|aarch64) arch=arm64 ;; *) die "unsupported CPU: $(uname -m)" ;; esac
  if [ ! -x .tools/node/bin/node ]; then
    say "Downloading Node.js $NODE_MAJOR (private to XDS)"
    base="https://nodejs.org/dist/latest-v$NODE_MAJOR.x"
    file=$(curl -fsSL "$base/SHASUMS256.txt" | awk '{print $2}' | grep "^node-v.*-$os-$arch.tar.gz$" | head -n 1)
    [ -n "$file" ] || die "no Node.js download for $os-$arch"
    rm -rf .tools/node && mkdir -p .tools/node
    curl -fsSL "$base/$file" | tar -xz -C .tools/node --strip-components 1
  fi
  PATH="$DIR/.tools/node/bin:$PATH"
fi

# 4. Install and build
say "Installing Python packages"
uv sync
say "Installing the studio's packages"
npm install --no-fund --no-audit
say "Installing the renderer (Chromium)"
uv run playwright install chromium
say "Building the studio"
npm run build
say "Putting the xds command on your PATH"
uv tool install --editable . --force
uv tool update-shell >/dev/null 2>&1 || true

cat <<EOF

XDS is installed in $DIR.

Open a new terminal, then:
  xds init ~/xd-projects/first --name "First" --format instagram-portrait
  xds open ~/xd-projects/first

Optional: the iPhone and MacBook models are not included; see
$DIR/xds/library/models/AGENTS.md to set them up.
EOF
if [ "$(uname -s)" = Linux ]; then
  echo "On Linux, if rendering fails with missing libraries, run once:"
  echo "  cd $DIR && sudo \$(which uv) run playwright install-deps chromium"
fi
