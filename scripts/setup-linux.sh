#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
  echo "This setup script supports Linux x86-64." >&2
  exit 1
fi
if ! command -v ffmpeg >/dev/null || ! command -v curl >/dev/null; then
  echo "Install ffmpeg and curl with your package manager, then run this script again." >&2
  exit 1
fi

root="${XDG_DATA_HOME:-$HOME/.local/share}/io.github.ethanramli.excalitutor"
model="$root/models/ggml-base.en.bin"
whisper="$root/tools/whisper-cli"
mkdir -p "$root/models" "$root/tools"
work="$(mktemp -d "$root/.setup-XXXXXXXX")"
trap 'rm -rf "$work"' EXIT

if [[ ! -x "$whisper/whisper-cli" ]] || ! "$whisper/whisper-cli" --help >/dev/null 2>&1; then
  archive="$work/whisper.tar.gz"
  curl --fail --location --retry 3 \
    https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-ubuntu-x64.tar.gz -o "$archive"
  printf '%s  %s\n' 'a72becf15d7917f990f6313867a52638b82b7f9ef237fb0c980dac56a135781c' "$archive" | sha256sum -c
  tar -xzf "$archive" -C "$work"
  release="$work/whisper-bin-ubuntu-x64"
  "$release/whisper-cli" --help >/dev/null
  mkdir -p "$whisper"
  cp -a "$release/whisper-cli" "$release"/libggml*.so* "$release"/libwhisper.so* "$release/LICENSE" "$whisper/"
fi

sha1='137c40403d78fd54d454da0f9bd998f78703390c'
if [[ ! -f "$model" ]] || ! printf '%s  %s\n' "$sha1" "$model" | sha1sum -c >/dev/null 2>&1; then
  curl --fail --location --retry 3 \
    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin -o "$work/model.bin"
  printf '%s  %s\n' "$sha1" "$work/model.bin" | sha1sum -c
  mv -f "$work/model.bin" "$model"
fi

echo "Offline English transcription is ready. Open Excali Tutor and select Record to use your microphone."
