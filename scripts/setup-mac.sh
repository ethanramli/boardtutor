#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != Darwin ]]; then
  echo "This setup script is for macOS." >&2
  exit 1
fi

if ! command -v brew >/dev/null; then
  for brew_path in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [[ -x "$brew_path" ]]; then
      eval "$("$brew_path" shellenv)"
      break
    fi
  done
fi
if ! command -v brew >/dev/null; then
  echo "Install Homebrew from https://brew.sh and run this script again." >&2
  exit 1
fi

brew install ffmpeg whisper.cpp
command -v ffmpeg >/dev/null
command -v whisper-cli >/dev/null

model_dir="${HOME}/Library/Application Support/io.github.ethanramli.excalitutor/models"
model="${model_dir}/ggml-base.en.bin"
sha1="137c40403d78fd54d454da0f9bd998f78703390c"
mkdir -p "$model_dir"
if [[ ! -f "$model" ]] || ! printf '%s  %s\n' "$sha1" "$model" | shasum -a 1 -c >/dev/null; then
  part="$(mktemp "${model_dir}/.whisper-XXXXXXXX")"
  trap 'rm -f "$part"' EXIT
  curl --fail --location --retry 3 \
    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin -o "$part"
  printf '%s  %s\n' "$sha1" "$part" | shasum -a 1 -c
  mv "$part" "$model"
fi
echo "Offline English transcription is ready. Open Excali Tutor and allow microphone access when you first record."
