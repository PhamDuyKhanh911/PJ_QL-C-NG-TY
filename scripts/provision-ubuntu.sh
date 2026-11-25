#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Script nay chi danh cho Ubuntu Linux." >&2
  exit 1
fi

SUDO=""
if [[ "$(id -u)" -ne 0 ]]; then
  if ! command -v sudo >/dev/null 2>&1; then
    echo "Can quyen root hoac sudo de cai Docker." >&2
    exit 1
  fi
  SUDO="sudo"
fi

$SUDO apt-get update
$SUDO apt-get install -y ca-certificates curl git openssl
$SUDO install -m 0755 -d /etc/apt/keyrings
$SUDO curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
$SUDO chmod a+r /etc/apt/keyrings/docker.asc

. /etc/os-release
if [[ "${ID:-}" != "ubuntu" ]]; then
  echo "He dieu hanh khong phai Ubuntu; dung lai de tranh them sai kho phan mem." >&2
  exit 1
fi

ARCH="$(dpkg --print-architecture)"
CODENAME="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
echo "deb [arch=$ARCH signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $CODENAME stable" | $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null
$SUDO apt-get update
$SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
$SUDO systemctl enable --now docker

echo "Docker da san sang:"
$SUDO docker version --format '{{.Server.Version}}'
$SUDO docker compose version
