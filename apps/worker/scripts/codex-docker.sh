#!/usr/bin/env bash
set -euo pipefail

image="${CODEX_DOCKER_IMAGE:-snatch-codex:local}"
dockerfile="${CODEX_DOCKERFILE_PATH:-}"
build_context="${CODEX_DOCKER_BUILD_CONTEXT:-}"
host_home="${CODEX_DOCKER_HOST_HOME:-${HOME:-}}"
stamp_dir="${host_home}/.codex/docker-build"
stamp_file=""

if [[ -n "$dockerfile" ]]; then
  if [[ -z "$build_context" ]]; then
    build_context="$(cd "$(dirname "$dockerfile")" && pwd)"
  fi
  dockerfile_mtime="$(stat -c %Y "$dockerfile")"
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
    docker build -f "$dockerfile" -t "$image" "$build_context"
    mkdir -p "$stamp_dir"
    echo "$dockerfile_mtime" > "$stamp_file"
  fi
fi

declare -A mount_modes

add_mount() {
  local path="$1"
  local mode="$2"

  if [[ -z "$path" ]]; then
    return
  fi

  if [[ ! -e "$path" ]]; then
    echo "codex-docker: path does not exist: $path" >&2
    exit 1
  fi

  if [[ -z "${mount_modes[$path]:-}" ]]; then
    mount_modes["$path"]="$mode"
    return
  fi

  if [[ "${mount_modes[$path]}" == "ro" && "$mode" == "rw" ]]; then
    mount_modes["$path"]="rw"
  fi
}

args=("$@")
idx=0
while [[ $idx -lt ${#args[@]} ]]; do
  case "${args[$idx]}" in
    --cd)
      idx=$((idx + 1))
      add_mount "${args[$idx]}" "rw"
      ;;
    --add-dir)
      idx=$((idx + 1))
      add_mount "${args[$idx]}" "ro"
      ;;
    --image)
      idx=$((idx + 1))
      add_mount "${args[$idx]}" "ro"
      ;;
    --output-schema)
      idx=$((idx + 1))
      add_mount "${args[$idx]}" "ro"
      ;;
  esac
  idx=$((idx + 1))
done

codex_home_mount=""
if [[ -n "$host_home" ]]; then
  mkdir -p "$host_home/.codex"
  codex_home_mount="$host_home/.codex:/home/codex/.codex"
fi

docker_args=(
  --rm
  -i
  --user "$(id -u):$(id -g)"
  -e "HOME=/home/codex"
)

for key in "${!mount_modes[@]}"; do
  mode="${mount_modes[$key]}"
  if [[ "$mode" == "ro" ]]; then
    docker_args+=( -v "$key:$key:ro" )
  else
    docker_args+=( -v "$key:$key" )
  fi
done

if [[ -n "${codex_home_mount}" ]]; then
  docker_args+=( -v "$codex_home_mount" )
fi

env_keys=()
while IFS='=' read -r key _; do
  case "$key" in
    OPENAI_*|CODEX_*|HTTP_PROXY|HTTPS_PROXY|NO_PROXY)
      env_keys+=("$key")
      ;;
  esac
done < <(env)

for key in "${env_keys[@]}"; do
  docker_args+=( -e "$key" )
done

exec docker run "${docker_args[@]}" "$image" "$@"
