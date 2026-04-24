#!/usr/bin/env bash
set -euo pipefail

ts() {
  date +'%Y-%m-%dT%H:%M:%S%z'
}

log() {
  echo "opencode-docker[$(ts)] $*" >&2
}

stat_mtime() {
  if stat -f %m "$1" >/dev/null 2>&1; then
    stat -f %m "$1"
    return
  fi
  stat -c %Y "$1"
}

image="${OPENCODE_DOCKER_IMAGE:-snatch-opencode:local}"
dockerfile="${OPENCODE_DOCKERFILE_PATH:-}"
build_context="${OPENCODE_DOCKER_BUILD_CONTEXT:-}"
host_home="${OPENCODE_DOCKER_HOST_HOME:-${HOME:-}}"
container_name="${OPENCODE_DOCKER_CONTAINER_NAME:-snatch-opencode-${USER:-user}}"
host_port="${OPENCODE_DOCKER_HOST_PORT:-}"
workdir="${OPENCODE_DOCKER_WORKDIR:-}"
workdir_mode="${OPENCODE_DOCKER_WORKDIR_MODE:-writable}"
additional_dirs="${OPENCODE_DOCKER_ADDITIONAL_DIRS:-}"
stamp_dir="${host_home}/.opencode/docker-build"
stamp_file=""

if [[ -z "$host_port" ]]; then
  echo "opencode-docker: OPENCODE_DOCKER_HOST_PORT is required" >&2
  exit 1
fi

if [[ -z "$workdir" ]]; then
  echo "opencode-docker: OPENCODE_DOCKER_WORKDIR is required" >&2
  exit 1
fi

if [[ -n "$dockerfile" ]]; then
  if [[ -z "$build_context" ]]; then
    build_context="$(cd "$(dirname "$dockerfile")" && pwd)"
  fi
  dockerfile_mtime="$(stat_mtime "$dockerfile")"
  image_key="$(echo "$image" | tr '/:' '__')"
  stamp_file="${stamp_dir}/${image_key}.stamp"
  rebuild_image="false"

  if ! docker image inspect "$image" >/dev/null 2>&1; then
    rebuild_image="true"
  elif [[ ! -f "$stamp_file" ]]; then
    rebuild_image="true"
  else
    last_build_mtime="$(cat "$stamp_file")"
    if [[ "$dockerfile_mtime" -gt "$last_build_mtime" ]]; then
      rebuild_image="true"
    fi
  fi

  if [[ "$rebuild_image" == "true" ]]; then
    log "building image=$image dockerfile=$dockerfile context=$build_context"
    docker build -f "$dockerfile" -t "$image" "$build_context"
    mkdir -p "$stamp_dir"
    echo "$dockerfile_mtime" > "$stamp_file"
  fi
fi

mount_paths=()
mount_modes=()

add_mount() {
  local path="$1"
  local mode="$2"
  local idx=0

  if [[ -z "$path" ]]; then
    return
  fi

  if [[ ! -e "$path" ]]; then
    echo "opencode-docker: path does not exist: $path" >&2
    exit 1
  fi

  while [[ $idx -lt ${#mount_paths[@]} ]]; do
    if [[ "${mount_paths[$idx]}" == "$path" ]]; then
      if [[ "${mount_modes[$idx]}" == "ro" && "$mode" == "rw" ]]; then
        mount_modes[$idx]="rw"
      fi
      return
    fi
    idx=$((idx + 1))
  done

  mount_paths+=("$path")
  mount_modes+=("$mode")
}

if [[ "$workdir_mode" == "readonly" ]]; then
  add_mount "$workdir" "ro"
else
  add_mount "$workdir" "rw"
fi

while IFS= read -r path; do
  add_mount "$path" "ro"
done <<EOF
$additional_dirs
EOF

opencode_home_mount=""
if [[ -n "$host_home" ]]; then
  mkdir -p "$host_home/.opencode"
  opencode_home_mount="$host_home/.opencode:/home/opencode/.opencode"
fi

env_file="$(mktemp "${TMPDIR:-/tmp}/sniptail-opencode-env.XXXXXX")"
cleanup_done="false"

cleanup() {
  if [[ "$cleanup_done" == "true" ]]; then
    return
  fi
  cleanup_done="true"
  rm -f "$env_file"
  docker stop "$container_name" >/dev/null 2>&1 || true
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}

trap 'cleanup' EXIT INT TERM

env | while IFS= read -r line; do
  key="${line%%=*}"
  case "$key" in
    OPENCODE_*|ANTHROPIC_*|OPENAI_*|GITHUB_*|GITLAB_*|AWS_*|GOOGLE_*|AZURE_*|HTTP_PROXY|HTTPS_PROXY|NO_PROXY)
      printf '%s\n' "$line" >> "$env_file"
      ;;
  esac
done

docker_args=(
  --rm
  -i
  --name "$container_name"
  --user "$(id -u):$(id -g)"
  -e "HOME=/home/opencode"
  --env-file "$env_file"
  -p "127.0.0.1:${host_port}:4096"
  -w "$workdir"
)

idx=0
while [[ $idx -lt ${#mount_paths[@]} ]]; do
  path="${mount_paths[$idx]}"
  mode="${mount_modes[$idx]}"
  if [[ "$mode" == "ro" ]]; then
    docker_args+=( -v "$path:$path:ro" )
  else
    docker_args+=( -v "$path:$path" )
  fi
  idx=$((idx + 1))
done

if [[ -n "$opencode_home_mount" ]]; then
  docker_args+=( -v "$opencode_home_mount" )
fi

log "docker run -> container_name=$container_name image=$image workdir=$workdir host_port=$host_port"
docker run "${docker_args[@]}" "$image" serve --hostname=0.0.0.0 --port=4096
