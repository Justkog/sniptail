#!/usr/bin/env bash
set -euo pipefail

REPO="${SNIPTAIL_REPO:-Justkog/sniptail}"
VERSION="${SNIPTAIL_VERSION:-latest}"
INSTALL_ROOT="${SNIPTAIL_INSTALL_ROOT:-$HOME/.sniptail}"
BIN_DIR="${SNIPTAIL_BIN_DIR:-$HOME/.local/bin}"

if [[ -z "${REPO}" ]]; then
  echo "SNIPTAIL_REPO is required (format: org/repo)."
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to install Sniptail."
  exit 1
fi

if ! command -v tar >/dev/null 2>&1; then
  echo "tar is required to install Sniptail."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to run Sniptail."
  exit 1
fi

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "${ARCH}" in
  x86_64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *)
    echo "Unsupported architecture: ${ARCH}"
    exit 1
    ;;
esac

case "${OS}" in
  darwin) OS="darwin" ;;
  linux) OS="linux" ;;
  *)
    echo "Unsupported OS: ${OS}"
    exit 1
    ;;
esac

if [[ "${VERSION}" == "latest" ]]; then
  TAG="$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/${REPO}/releases/latest" | awk -F/ '{print $NF}')"
else
  TAG="v${VERSION#v}"
fi

if [[ -z "${TAG}" ]]; then
  echo "Failed to resolve release tag."
  exit 1
fi

NAME="sniptail-${TAG}-${OS}-${ARCH}"
TARBALL="${NAME}.tar.gz"
SHA_FILE="${NAME}.sha256"
URL_BASE="https://github.com/${REPO}/releases/download/${TAG}"

mkdir -p "${INSTALL_ROOT}" "${BIN_DIR}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

curl -fsSL "${URL_BASE}/${TARBALL}" -o "${TMP_DIR}/${TARBALL}"

if curl -fsSL "${URL_BASE}/${SHA_FILE}" -o "${TMP_DIR}/${SHA_FILE}"; then
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "${TMP_DIR}" && sha256sum -c "${SHA_FILE}")
  elif command -v shasum >/dev/null 2>&1; then
    (cd "${TMP_DIR}" && shasum -a 256 -c "${SHA_FILE}")
  else
    echo "Warning: sha256sum/shasum not found; skipping checksum verification."
  fi
else
  echo "Warning: checksum file not found; skipping verification."
fi

tar -xzf "${TMP_DIR}/${TARBALL}" -C "${INSTALL_ROOT}"

ln -sfn "${INSTALL_ROOT}/${NAME}" "${INSTALL_ROOT}/current"
ln -sfn "${INSTALL_ROOT}/current/bin/sniptail" "${BIN_DIR}/sniptail"

echo "Sniptail installed to ${BIN_DIR}/sniptail"
echo "Add ${BIN_DIR} to your PATH if needed."
