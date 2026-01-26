#!/usr/bin/env bash
set -euo pipefail

image="${GH_COPILOT_DOCKER_IMAGE:-snatch-copilot:local}"
dockerfile="${GH_COPILOT_DOCKERFILE_PATH:-}"
build_context="${GH_COPILOT_DOCKER_BUILD_CONTEXT:-}"
host_home="${GH_COPILOT_DOCKER_HOST_HOME:-${HOME:-}}"
stamp_dir="${host_home}/.copilot/docker-build"
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
    echo "copilot-docker: path does not exist: $path" >&2
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
    --add-dir)
      idx=$((idx + 1))
      add_mount "${args[$idx]}" "ro"
      ;;
    --config-dir)
      idx=$((idx + 1))
      add_mount "${args[$idx]}" "rw"
      ;;
    --log-dir)
      idx=$((idx + 1))
      add_mount "${args[$idx]}" "rw"
      ;;
    --additional-mcp-config)
      idx=$((idx + 1))
      if [[ "${args[$idx]}" == @* ]]; then
        add_mount "${args[$idx]#@}" "ro"
      fi
      ;;
    --share)
      if [[ $((idx + 1)) -lt ${#args[@]} && "${args[$((idx + 1))]}" != -* ]]; then
        idx=$((idx + 1))
        add_mount "${args[$idx]}" "rw"
      fi
      ;;
  esac
  idx=$((idx + 1))
done

copilot_home_mount=""
if [[ -n "$host_home" ]]; then
  mkdir -p "$host_home/.copilot"
  copilot_home_mount="$host_home/.copilot:/home/copilot/.copilot"
fi

workdir="$(pwd)"
add_mount "$workdir" "rw"

docker_args=(
  --rm
  -i
  --user "$(id -u):$(id -g)"
  -e "HOME=/home/copilot"
  -w "$workdir"
)

for key in "${!mount_modes[@]}"; do
  mode="${mount_modes[$key]}"
  if [[ "$mode" == "ro" ]]; then
    docker_args+=( -v "$key:$key:ro" )
  else
    docker_args+=( -v "$key:$key" )
  fi
done

if [[ -n "${copilot_home_mount}" ]]; then
  docker_args+=( -v "$copilot_home_mount" )
fi

env_keys=()
while IFS='=' read -r key _; do
  case "$key" in
    COPILOT_*|GITHUB_*|GH_*|HTTP_PROXY|HTTPS_PROXY|NO_PROXY)
      env_keys+=("$key")
      ;;
  esac
done < <(env)

for key in "${env_keys[@]}"; do
  docker_args+=( -e "$key" )
done

exec docker run "${docker_args[@]}" "$image" "$@"
