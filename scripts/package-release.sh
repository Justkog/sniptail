#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/package-release.sh --version <version> [--os <linux|darwin>] [--arch <x64|arm64>] [--output-dir <dir>] [--release-dir <dir>]

Builds a release tarball with production dependencies included.
EOF
}

log() {
  printf '[package-release] %s\n' "$*"
}

detect_os() {
  case "$(uname -s | tr '[:upper:]' '[:lower:]')" in
    linux) echo "linux" ;;
    darwin) echo "darwin" ;;
    *)
      echo "Unsupported OS: $(uname -s)" >&2
      exit 1
      ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64) echo "x64" ;;
    arm64 | aarch64) echo "arm64" ;;
    *)
      echo "Unsupported architecture: $(uname -m)" >&2
      exit 1
      ;;
  esac
}

main() {
  local project_root version os_name arch output_dir release_dir name stage_root tarball_path sha_path
  local sea_config_path sea_blob_path node_bin
  local -a postject_args

  project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  version=""
  os_name=""
  arch=""
  output_dir="${project_root}"
  release_dir="${project_root}/release"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --version)
        version="${2:-}"
        shift 2
        ;;
      --os)
        os_name="${2:-}"
        shift 2
        ;;
      --arch)
        arch="${2:-}"
        shift 2
        ;;
      --output-dir)
        output_dir="${2:-}"
        shift 2
        ;;
      --release-dir)
        release_dir="${2:-}"
        shift 2
        ;;
      -h | --help)
        usage
        exit 0
        ;;
      *)
        echo "Unknown argument: $1" >&2
        usage
        exit 1
        ;;
    esac
  done

  if [[ -z "${version}" ]]; then
    echo "--version is required" >&2
    usage
    exit 1
  fi

  if ! command -v pnpm >/dev/null 2>&1; then
    echo "pnpm is required to package a release." >&2
    exit 1
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo "node is required to package a release." >&2
    exit 1
  fi

  cd "${project_root}"

  for required_dir in apps/bot/dist apps/worker/dist packages/core/dist packages/cli/dist; do
    if [[ ! -d "${required_dir}" ]]; then
      echo "Missing ${required_dir}. Run \"pnpm run build\" first." >&2
      exit 1
    fi
  done

  version="${version#v}"
  if [[ -z "${version}" ]]; then
    echo "Invalid version" >&2
    exit 1
  fi

  if [[ -z "${os_name}" ]]; then
    os_name="$(detect_os)"
  fi
  if [[ -z "${arch}" ]]; then
    arch="$(detect_arch)"
  fi

  case "${os_name}" in
    linux | darwin) ;;
    *)
      echo "Unsupported --os value: ${os_name}" >&2
      exit 1
      ;;
  esac

  case "${arch}" in
    x64 | arm64) ;;
    *)
      echo "Unsupported --arch value: ${arch}" >&2
      exit 1
      ;;
  esac

  mkdir -p "${output_dir}" "${release_dir}"
  output_dir="$(cd "${output_dir}" && pwd)"
  release_dir="$(cd "${release_dir}" && pwd)"

  name="sniptail-v${version}-${os_name}-${arch}"
  stage_root="${release_dir}/${name}"

  log "Preparing staged release root at ${stage_root}"
  rm -rf "${stage_root}"
  mkdir -p "${stage_root}"

  # Workspace metadata required to install production dependencies in the staged root.
  cp package.json pnpm-lock.yaml pnpm-workspace.yaml "${stage_root}/"
  if [[ -f .npmrc ]]; then
    cp .npmrc "${stage_root}/"
  fi

  # Package manifests + builds.
  mkdir -p "${stage_root}/apps/bot" "${stage_root}/apps/worker"
  mkdir -p "${stage_root}/packages/core" "${stage_root}/packages/cli"
  cp apps/bot/package.json "${stage_root}/apps/bot/"
  cp apps/worker/package.json "${stage_root}/apps/worker/"
  cp packages/core/package.json "${stage_root}/packages/core/"
  cp packages/cli/package.json "${stage_root}/packages/cli/"
  cp -R apps/bot/dist "${stage_root}/apps/bot/"
  cp -R apps/worker/dist "${stage_root}/apps/worker/"
  cp -R apps/worker/scripts "${stage_root}/apps/worker/"
  cp -R packages/core/dist "${stage_root}/packages/core/"
  cp -R packages/core/drizzle "${stage_root}/packages/core/"
  cp -R packages/cli/dist "${stage_root}/packages/cli/"

  log "Installing production dependencies in staged release root"
  (
    cd "${stage_root}"
    pnpm install --prod --frozen-lockfile --prefer-offline
  )

  # Runtime scripts + templates.
  mkdir -p "${stage_root}/scripts"
  cp scripts/register-loaders.mjs "${stage_root}/scripts/"
  cp scripts/md-raw-loader.mjs "${stage_root}/scripts/"
  cp scripts/sea-bootstrap.cjs "${stage_root}/scripts/"
  cp scripts/generate-slack-manifest.mjs "${stage_root}/scripts/"
  cp scripts/slack-app-manifest.template.yaml "${stage_root}/scripts/"

  # Config + docs.
  cp sniptail.bot.toml sniptail.worker.toml "${stage_root}/"
  cp .env.example "${stage_root}/"
  cp README.md LICENSE "${stage_root}/"
  cp Dockerfile.codex Dockerfile.copilot "${stage_root}/"
  mkdir -p "${stage_root}/docs"
  cp docs/slack-bot-setup.md docs/discord-bot-setup.md "${stage_root}/docs/"

  # Optional allowlist example.
  cat >"${stage_root}/repo-allowlist.example.json" <<'JSON'
{
  "example-repo": {
    "sshUrl": "git@gitlab.com:org/repo.git",
    "projectId": 12345
  }
}
JSON

  # SEA launcher.
  mkdir -p "${stage_root}/bin"
  sea_config_path="${stage_root}/sea-config.json"
  sea_blob_path="${stage_root}/sea-prep.blob"
  node_bin="$(command -v node)"

cat >"${sea_config_path}" <<JSON
{
  "main": "${stage_root}/scripts/sea-bootstrap.cjs",
  "output": "${sea_blob_path}",
  "disableExperimentalSEAWarning": true
}
JSON

  log "Generating SEA blob"
  node --experimental-sea-config "${sea_config_path}"

  log "Copying Node runtime to ${stage_root}/bin/sniptail"
  cp "${node_bin}" "${stage_root}/bin/sniptail"

  postject_args=(
    "${stage_root}/bin/sniptail"
    NODE_SEA_BLOB
    "${sea_blob_path}"
    --sentinel-fuse
    NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
  )
  if [[ "${os_name}" == "darwin" ]]; then
    postject_args+=(--macho-segment-name NODE_SEA)
  fi

  log "Injecting SEA blob into sniptail binary"
  PNPM_PREFER_OFFLINE=true pnpm dlx postject@1.0.0-alpha.6 "${postject_args[@]}"

  if [[ "${os_name}" == "darwin" ]] && command -v codesign >/dev/null 2>&1; then
    log "Applying ad-hoc code signature to sniptail binary"
    codesign --sign - --force "${stage_root}/bin/sniptail"
  fi

  rm -f "${sea_config_path}" "${sea_blob_path}"
  chmod +x "${stage_root}/bin/sniptail"

  tarball_path="${output_dir}/${name}.tar.gz"
  sha_path="${output_dir}/${name}.sha256"

  log "Creating tarball ${tarball_path}"
  tar -czf "${tarball_path}" -C "${release_dir}" "${name}"

  if command -v shasum >/dev/null 2>&1; then
    (cd "${output_dir}" && shasum -a 256 "${name}.tar.gz" >"${name}.sha256")
  else
    (cd "${output_dir}" && sha256sum "${name}.tar.gz" >"${name}.sha256")
  fi

  log "Created ${tarball_path}"
  log "Created ${sha_path}"
}

main "$@"
