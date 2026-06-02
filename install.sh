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
CONFIG_DIR="${SNIPTAIL_CONFIG_DIR:-${INSTALL_ROOT}/config}"
CONFIG_EXISTING="${SNIPTAIL_CONFIG_EXISTING:-}"
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

has_tty() {
  [[ -t 1 ]] && { true < /dev/tty > /dev/tty; } 2>/dev/null
}

choose_config_policy() {
  local requested="${CONFIG_EXISTING}"

  if [[ -z "${requested}" ]]; then
    if has_tty; then
      requested="prompt"
    else
      requested="new"
    fi
  fi

  case "${requested}" in
    preserve|new|replace)
      printf '%s\n' "${requested}"
      return
      ;;
    prompt)
      if ! has_tty; then
        printf '%s\n' "new"
        return
      fi

      printf '\nExisting Sniptail config found in %s.\n' "${CONFIG_DIR}" > /dev/tty
      printf 'Choose how to handle existing config files:\n' > /dev/tty
      printf '  1) Preserve existing files\n' > /dev/tty
      printf '  2) Preserve existing files and write release templates as .new files\n' > /dev/tty
      printf '  3) Back up existing files and replace them with release templates\n' > /dev/tty
      printf 'Selection [2]: ' > /dev/tty

      local answer
      IFS= read -r answer < /dev/tty || answer=""
      case "${answer}" in
        1) printf '%s\n' "preserve" ;;
        3) printf '%s\n' "replace" ;;
        *) printf '%s\n' "new" ;;
      esac
      ;;
    *)
      fail "Invalid SNIPTAIL_CONFIG_EXISTING: ${requested}. Use prompt, preserve, new, or replace."
      ;;
  esac
}

has_existing_config() {
  [[ -e "${CONFIG_DIR}/sniptail.bot.toml" ]] \
    || [[ -e "${CONFIG_DIR}/sniptail.worker.toml" ]] \
    || [[ -e "${CONFIG_DIR}/.env" ]]
}

install_config_file() {
  local source_path="$1"
  local target_path="$2"
  local policy="$3"

  if [[ ! -f "${source_path}" ]]; then
    fail "Missing config template in release: ${source_path}"
  fi

  if [[ ! -e "${target_path}" ]]; then
    cp "${source_path}" "${target_path}"
    log "Created ${target_path}"
    return
  fi

  case "${policy}" in
    preserve)
      log "Preserved existing ${target_path}"
      ;;
    new)
      if cmp -s "${source_path}" "${target_path}"; then
        log "Preserved existing ${target_path}"
      else
        cp "${source_path}" "${target_path}.new"
        log "Preserved existing ${target_path}; wrote ${target_path}.new"
      fi
      ;;
    replace)
      local backup_path="${target_path}.bak.$(date +%Y%m%d%H%M%S).$$"
      mv "${target_path}" "${backup_path}"
      cp "${source_path}" "${target_path}"
      log "Replaced ${target_path}; backup: ${backup_path}"
      ;;
    *)
      fail "Invalid config policy: ${policy}"
      ;;
  esac
}

install_config_files() {
  local policy="new"

  mkdir -p "${CONFIG_DIR}"

  if has_existing_config; then
    policy="$(choose_config_policy)"
  fi

  log "Config directory: ${CONFIG_DIR}"
  log "Existing config policy: ${policy}"

  install_config_file "${INSTALL_ROOT}/current/sniptail.bot.toml" "${CONFIG_DIR}/sniptail.bot.toml" "${policy}"
  install_config_file "${INSTALL_ROOT}/current/sniptail.worker.toml" "${CONFIG_DIR}/sniptail.worker.toml" "${policy}"
  install_config_file "${INSTALL_ROOT}/current/.env.example" "${CONFIG_DIR}/.env" "${policy}"
}


if [[ -z "${REPO}" ]]; then
  fail "SNIPTAIL_REPO is required (format: org/repo)."
fi

if ! command -v tar >/dev/null 2>&1; then
  fail "tar is required to install Sniptail."
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
  TARBALL="${NAME}.tar.xz"
  TARBALL_LEGACY="${NAME}.tar.gz"
  SHA_FILE="${NAME}.sha256"
  URL_BASE="https://github.com/${REPO}/releases/download/${TAG}"
  log "Selected ${TAG} for ${OS}/${ARCH}"
fi

mkdir -p "${INSTALL_ROOT}" "${BIN_DIR}" "${CONFIG_DIR}"
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
    if ! command -v node >/dev/null 2>&1; then
      fail "node is required for authenticated GitHub API downloads. Install Node.js or unset GH_TOKEN/GITHUB_TOKEN to use direct (unauthenticated) downloads."
    fi

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
      TARBALL="${TARBALL_LEGACY}"
      tar_id="$(find_asset_id "${TARBALL}")" || true
      if [[ -n "${tar_id}" ]]; then
        log "Falling back to legacy release asset ${TARBALL}"
      fi
    fi
    if [[ -z "${tar_id}" ]]; then
      warn "Assets in release ${TAG}:"
      node -e '
        const fs = require("fs");
        const j = JSON.parse(fs.readFileSync(0, "utf8"));
        for (const a of (j.assets || [])) console.log(" - " + a.name);
      ' <<<"${release_json}" >&2
      fail "Could not find asset '${NAME}.tar.xz' or '${NAME}.tar.gz' in release ${TAG}."
    fi

    TARBALL_PATH="${TMP_DIR}/${TARBALL}"
    log "Downloading ${TARBALL}"

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
    if ! curl -fsSL "${URL_BASE}/${TARBALL}" -o "${TARBALL_PATH}"; then
      TARBALL="${TARBALL_LEGACY}"
      TARBALL_PATH="${TMP_DIR}/${TARBALL}"
      log "Falling back to legacy release asset ${TARBALL}"
      curl -fsSL "${URL_BASE}/${TARBALL}" -o "${TARBALL_PATH}"
    fi

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

ROOT_ENTRY="$(tar -tf "${TARBALL_PATH}" | sed -n '1p')"
if [[ -z "${ROOT_ENTRY}" ]]; then
  fail "Tarball is empty or unreadable: ${TARBALL_PATH}"
fi

ROOT_ENTRY="${ROOT_ENTRY#./}"
RELEASE_DIR="${ROOT_ENTRY%%/*}"

if [[ -z "${RELEASE_DIR}" ]]; then
  fail "Could not determine release directory from tarball: ${TARBALL_PATH}"
fi

log "Extracting ${RELEASE_DIR}"
tar -xf "${TARBALL_PATH}" -C "${INSTALL_ROOT}"

log "Updating current -> ${RELEASE_DIR}"
ln -sfn "${INSTALL_ROOT}/${RELEASE_DIR}" "${INSTALL_ROOT}/current"

install_config_files

log "Writing launcher script"
LAUNCHER_TMP="${BIN_DIR}/.sniptail-launcher.$$"
cat > "${LAUNCHER_TMP}" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export DOTENV_CONFIG_PATH="\${DOTENV_CONFIG_PATH:-${CONFIG_DIR}/.env}"
export SNIPTAIL_BOT_CONFIG_PATH="\${SNIPTAIL_BOT_CONFIG_PATH:-${CONFIG_DIR}/sniptail.bot.toml}"
export SNIPTAIL_WORKER_CONFIG_PATH="\${SNIPTAIL_WORKER_CONFIG_PATH:-${CONFIG_DIR}/sniptail.worker.toml}"
exec "${INSTALL_ROOT}/current/bin/sniptail" "\$@"
EOF
chmod +x "${LAUNCHER_TMP}"
mv -f "${LAUNCHER_TMP}" "${BIN_DIR}/sniptail"

log "Installed to ${BIN_DIR}/sniptail"
log "Run: ${BIN_DIR}/sniptail --help"
