#!/usr/bin/env bash
#
# Prepares a fresh Ubuntu Server 24.04 VM to run the book portal.
# Installs Docker from Docker's own repository, adds swap if the VM is small,
# and creates the deploy directory. Safe to run twice.
#
#   curl -fsSL -o bootstrap.sh https://raw.githubusercontent.com/YOU/book-portal/main/scripts/server-bootstrap.sh
#   bash bootstrap.sh
#
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/book-portal}"

say() { printf '\n\033[1;32m==>\033[0m %s\n' "$1"; }

if [[ $EUID -eq 0 ]]; then
  echo "Run this as your normal user, not root. It calls sudo where it needs to." >&2
  exit 1
fi

say "Updating packages"
sudo apt-get update -qq
sudo apt-get upgrade -y -qq
sudo apt-get install -y -qq ca-certificates curl gnupg git

# Ubuntu's own docker.io package trails Docker's releases and, more importantly,
# ships no compose plugin - so `docker compose` is simply absent. The snap build
# is confined and cannot bind-mount from /opt. Docker's repository is the only
# one of the three that gives you a working `docker compose` here.
if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker Engine"
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg |
    sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg

  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" |
    sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

  sudo apt-get update -qq
  sudo apt-get install -y -qq \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  say "Docker already installed, skipping"
fi

if ! groups "$USER" | grep -qw docker; then
  say "Adding $USER to the docker group"
  sudo usermod -aG docker "$USER"
  NEEDS_RELOGIN=1
fi

# `next build` peaks around 2 GB. On a 2 GB VM it is killed by the OOM reaper
# partway through, which surfaces as a build that stops with no error at all.
TOTAL_MB=$(free -m | awk '/^Mem:/ {print $2}')
if [[ $TOTAL_MB -lt 4000 ]] && ! sudo swapon --show | grep -q .; then
  say "Only ${TOTAL_MB} MB RAM - adding 2 GB of swap so the build survives"
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

say "Creating $DEPLOY_DIR"
sudo mkdir -p "$DEPLOY_DIR"
sudo chown "$USER":"$USER" "$DEPLOY_DIR"

if [[ ! -f "$HOME/.ssh/id_ed25519" ]]; then
  say "Generating an SSH key for GitHub"
  ssh-keygen -t ed25519 -C "book-portal@$(hostname)" -f "$HOME/.ssh/id_ed25519" -N ""
fi

say "Done"
echo
echo "Docker:  $(docker --version 2>/dev/null || echo 'available after re-login')"
echo "Compose: $(docker compose version 2>/dev/null || echo 'available after re-login')"
echo
echo "Add this key to GitHub as a deploy key on the repository:"
echo
cat "$HOME/.ssh/id_ed25519.pub"
echo
if [[ -n "${NEEDS_RELOGIN:-}" ]]; then
  echo "Log out and back in before running docker, so the group change applies."
fi
