#!/usr/bin/env bash
# CyberTip Triage — One-Command Installer
# Usage: bash install.sh
# Or: curl -sSL https://raw.githubusercontent.com/akshayjava/cybertip-triage/main/install.sh | bash

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

print_banner() {
  echo ""
  echo -e "${BOLD}${BLUE}╔═══════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${BLUE}║  🛡  CyberTip Triage — ICAC Installation         ║${NC}"
  echo -e "${BOLD}${BLUE}╚═══════════════════════════════════════════════════╝${NC}"
  echo ""
}

ok()   { echo -e "${GREEN}  ✓ $1${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $1${NC}"; }
fail() { echo -e "${RED}  ✗ $1${NC}"; exit 1; }
info() { echo -e "${CYAN}  → $1${NC}"; }
step() { echo ""; echo -e "${BOLD}  $1${NC}"; echo ""; }

# ── Check OS ──────────────────────────────────────────────────────────────────
check_os() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    OS="mac"
  elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"
  elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
    OS="windows"
    warn "Windows detected — recommend using WSL2 or Docker Desktop"
  else
    warn "Unknown OS: $OSTYPE — proceeding anyway"
    OS="unknown"
  fi
  ok "OS: $OS"
}

# ── Check Node.js ─────────────────────────────────────────────────────────────
check_node() {
  if ! command -v node &>/dev/null; then
    warn "Node.js not found"
    install_node
    return
  fi

  NODE_VER=$(node --version | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VER" -lt 20 ]; then
    warn "Node.js v20+ required, found v$(node --version)"
    install_node
  else
    ok "Node.js $(node --version)"
  fi
}

install_node() {
  info "Installing Node.js v20..."
  if [[ "$OS" == "mac" ]]; then
    if command -v brew &>/dev/null; then
      brew install node@20
    else
      fail "Homebrew not found. Install from https://brew.sh then re-run this script."
    fi
  elif [[ "$OS" == "linux" ]]; then
    if command -v apt-get &>/dev/null; then
      curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
      sudo apt-get install -y nodejs
    elif command -v dnf &>/dev/null; then
      sudo dnf install nodejs -y
    else
      fail "Cannot auto-install Node.js. Install v20+ from https://nodejs.org then re-run."
    fi
  else
    fail "Cannot auto-install Node.js on this OS. Install v20+ from https://nodejs.org"
  fi
  ok "Node.js installed"
}

# ── Check Docker ──────────────────────────────────────────────────────────────
check_docker() {
  if command -v docker &>/dev/null && docker compose version &>/dev/null 2>&1; then
    DOCKER_AVAILABLE=true
    ok "Docker + Docker Compose"
  else
    DOCKER_AVAILABLE=false
    warn "Docker not found — will use Node.js mode"
    info "Install Docker Desktop from https://docker.com/products/docker-desktop"
  fi
}

# ── Check Git ─────────────────────────────────────────────────────────────────
check_git() {
  if ! command -v git &>/dev/null; then
    fail "Git not found. Install from https://git-scm.com"
  fi
  ok "Git $(git --version | cut -d' ' -f3)"
}

# ── Clone or update ───────────────────────────────────────────────────────────
get_code() {
  INSTALL_DIR="${1:-$HOME/cybertip-triage}"

  if [ -d "$INSTALL_DIR/.git" ]; then
    info "Updating existing installation at $INSTALL_DIR"
    cd "$INSTALL_DIR"
    git pull --quiet
    ok "Code updated"
  else
    info "Downloading CyberTip Triage to $INSTALL_DIR"
    git clone --quiet https://github.com/akshayjava/cybertip-triage.git "$INSTALL_DIR"
    cd "$INSTALL_DIR"
    ok "Code downloaded"
  fi
}

# ── Install dependencies ──────────────────────────────────────────────────────
install_deps() {
  info "Installing dependencies..."
  npm install --quiet --no-fund 2>/dev/null || npm install --no-fund
  ok "Dependencies installed"
}

# ── Run setup wizard ──────────────────────────────────────────────────────────
run_wizard() {
  echo ""
  echo -e "${BOLD}  Ready to configure your task force settings.${NC}"
  echo ""
  node setup/wizard.mjs
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
  print_banner

  INSTALL_DIR="${CYBERTIP_DIR:-$HOME/cybertip-triage}"

  step "Checking requirements..."
  check_os
  check_git
  check_node
  check_docker

  step "Getting the code..."
  get_code "$INSTALL_DIR"

  step "Installing dependencies..."
  install_deps

  step "Running setup wizard..."
  run_wizard
}

main "$@"
