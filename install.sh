#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[sniptail-install] %s\n' "$*"
}

warn() {
  printf '[sniptail-install] warning: %s\n' "$*" >&2
}

fail() {
  printf '[sniptail-install] error: %s\n' "$*" >&2
  exit 1
}

REPO="${SNIPTAIL_REPO:-Justkog/sniptail}"
VERSION="${SNIPTAIL_VERSION:-latest}"
INSTALL_ROOT="${SNIPTAIL_INSTALL_ROOT:-$HOME/.sniptail}"
BIN_DIR="${SNIPTAIL_BIN_DIR:-$HOME/.local/bin}"
LOCAL_TARBALL="${SNIPTAIL_TARBALL:-}"

# Token for private repos (supports several common env var names)
GH_TOKEN="${GITHUB_API_TOKEN:-${GITHUB_TOKEN:-${GH_TOKEN:-}}}"

curl_auth_args=()
if [[ -n "${GH_TOKEN}" ]]; then
  curl_auth_args=(-H "Authorization: Bearer ${GH_TOKEN}")
fi

api_get() {
  curl -fsSL "${curl_auth_args[@]}" "$1"
}


if [[ -z "${REPO}" ]]; then
  fail "SNIPTAIL_REPO is required (format: org/repo)."
fi

if ! command -v tar >/dev/null 2>&1; then
  fail "tar is required to install Sniptail."
fi

if ! command -v node >/dev/null 2>&1; then
  fail "Node.js is required to run Sniptail."
fi

if [[ -z "${LOCAL_TARBALL}" ]]; then
  if ! command -v curl >/dev/null 2>&1; then
    fail "curl is required to install Sniptail."
  fi

  log "Resolving platform and release tag"
  OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
  ARCH="$(uname -m)"

  case "${ARCH}" in
    x86_64) ARCH="x64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *)
      fail "Unsupported architecture: ${ARCH}"
      ;;
  esac

  case "${OS}" in
    darwin) OS="darwin" ;;
    linux) OS="linux" ;;
    *)
      fail "Unsupported OS: ${OS}"
      ;;
  esac

  if [[ "${VERSION}" == "latest" ]]; then
    TAG="$(curl -fsSL "${curl_auth_args[@]}" \
      "https://api.github.com/repos/${REPO}/releases/latest" \
      | awk -F'"tag_name": "' 'NF>1{split($2,a,"\""); print a[1]; exit}')"
  else
    TAG="v${VERSION#v}"
  fi

  if [[ -z "${TAG}" ]]; then
    fail "Failed to resolve release tag."
  fi

  NAME="sniptail-${TAG}-${OS}-${ARCH}"
  TARBALL="${NAME}.tar.gz"
  SHA_FILE="${NAME}.sha256"
  URL_BASE="https://github.com/${REPO}/releases/download/${TAG}"
  log "Selected ${TAG} for ${OS}/${ARCH}"
fi

mkdir -p "${INSTALL_ROOT}" "${BIN_DIR}"
log "Install root: ${INSTALL_ROOT}"
log "CLI link path: ${BIN_DIR}/sniptail"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

if [[ -n "${LOCAL_TARBALL}" ]]; then
  if [[ ! -f "${LOCAL_TARBALL}" ]]; then
    fail "Local tarball not found: ${LOCAL_TARBALL}"
  fi
  TARBALL_PATH="${LOCAL_TARBALL}"
  log "Using local tarball: ${TARBALL_PATH}"
else
  TARBALL_PATH="${TMP_DIR}/${TARBALL}"

  if [[ -n "${GH_TOKEN}" ]]; then
    log "Downloading ${TARBALL} via GitHub API (authenticated)"

    release_json="$(api_get "https://api.github.com/repos/${REPO}/releases/tags/${TAG}")"

    find_asset_id() {
      local name="$1"
      node -e '
        const fs = require("fs");
        const target = process.argv[1];
        const json = JSON.parse(fs.readFileSync(0, "utf8"));
        const assets = json.assets || [];
        const hit = assets.find(a => a && a.name === target);
        if (!hit) process.exit(2);
        process.stdout.write(String(hit.id));
      ' "${name}" <<<"${release_json}"
    }

    tar_id="$(find_asset_id "${TARBALL}")" || true
    if [[ -z "${tar_id}" ]]; then
      warn "Assets in release ${TAG}:"
      node -e '
        const fs = require("fs");
        const j = JSON.parse(fs.readFileSync(0, "utf8"));
        for (const a of (j.assets || [])) console.log(" - " + a.name);
      ' <<<"${release_json}" >&2
      fail "Could not find asset '${TARBALL}' in release ${TAG}."
    fi

    curl -fL "${curl_auth_args[@]}" \
      -H "Accept: application/octet-stream" \
      "https://api.github.com/repos/${REPO}/releases/assets/${tar_id}" \
      -o "${TARBALL_PATH}"

    log "Checking checksum (if available)"
    sha_id="$(find_asset_id "${SHA_FILE}")" || true
    if [[ -n "${sha_id}" ]]; then
      curl -fL "${curl_auth_args[@]}" \
        -H "Accept: application/octet-stream" \
        "https://api.github.com/repos/${REPO}/releases/assets/${sha_id}" \
        -o "${TMP_DIR}/${SHA_FILE}"

      if command -v sha256sum >/dev/null 2>&1; then
        (cd "${TMP_DIR}" && sha256sum -c "${SHA_FILE}")
      elif command -v shasum >/dev/null 2>&1; then
        (cd "${TMP_DIR}" && shasum -a 256 -c "${SHA_FILE}")
      else
        warn "sha256sum/shasum not found; skipping checksum verification."
      fi
    else
      warn "checksum file not found; skipping verification."
    fi

  else
    log "Downloading ${TARBALL}"
    curl -fsSL "${URL_BASE}/${TARBALL}" -o "${TARBALL_PATH}"

    log "Checking checksum (if available)"
    if curl -fsSL "${URL_BASE}/${SHA_FILE}" -o "${TMP_DIR}/${SHA_FILE}"; then
      if command -v sha256sum >/dev/null 2>&1; then
        (cd "${TMP_DIR}" && sha256sum -c "${SHA_FILE}")
      elif command -v shasum >/dev/null 2>&1; then
        (cd "${TMP_DIR}" && shasum -a 256 -c "${SHA_FILE}")
      else
        warn "sha256sum/shasum not found; skipping checksum verification."
      fi
    else
      warn "checksum file not found; skipping verification."
    fi
  fi
fi

ROOT_ENTRY="$(tar -tzf "${TARBALL_PATH}" | sed -n '1p')"
if [[ -z "${ROOT_ENTRY}" ]]; then
  fail "Tarball is empty or unreadable: ${TARBALL_PATH}"
fi

ROOT_ENTRY="${ROOT_ENTRY#./}"
RELEASE_DIR="${ROOT_ENTRY%%/*}"

if [[ -z "${RELEASE_DIR}" ]]; then
  fail "Could not determine release directory from tarball: ${TARBALL_PATH}"
fi

log "Extracting ${RELEASE_DIR}"
tar -xzf "${TARBALL_PATH}" -C "${INSTALL_ROOT}"

log "Updating current -> ${RELEASE_DIR}"
ln -sfn "${INSTALL_ROOT}/${RELEASE_DIR}" "${INSTALL_ROOT}/current"

log "Writing launcher script"
LAUNCHER_TMP="${BIN_DIR}/.sniptail-launcher.$$"
cat > "${LAUNCHER_TMP}" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec "${INSTALL_ROOT}/current/bin/sniptail" "\$@"
EOF
chmod +x "${LAUNCHER_TMP}"
mv -f "${LAUNCHER_TMP}" "${BIN_DIR}/sniptail"

log "Installed to ${BIN_DIR}/sniptail"
log "Run: ${BIN_DIR}/sniptail --help"
