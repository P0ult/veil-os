#!/bin/bash
# Shared by every step that runs inside the chroot.

# shellcheck source=../config.sh
source /tmp/veil/config.sh

export DEBIAN_FRONTEND=noninteractive
export APT_LISTCHANGES_FRONTEND=none

# Keep a changed config file's shipped version, never stop to ask.
APT=(apt-get -y -q
     -o Dpkg::Options::=--force-confdef
     -o Dpkg::Options::=--force-confold
     -o APT::Acquire::Retries=5)

say() { printf '    -> %s\n' "$*"; }

# Install every package named in a list file under /tmp/veil.
install_list() {
    local file="/tmp/veil/$1"
    local pkgs=()
    mapfile -t pkgs < <(sed -e 's/#.*//' -e 's/[[:space:]]//g' -e '/^$/d' "$file")
    say "installing ${#pkgs[@]} packages from $1"
    "${APT[@]}" install "${pkgs[@]}"
}

# Download with retries. GitHub's API is asked with the CI token when there is
# one: unauthenticated, it allows sixty requests an hour per address, and a
# shared CI runner's address has usually spent them.
fetch() {
    local args=(-fsSL --retry 5 --retry-delay 5 --connect-timeout 30)
    case "$*" in
        *api.github.com*)
            [ -n "${GITHUB_TOKEN:-}" ] && args+=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
            ;;
    esac
    curl "${args[@]}" "$@"
}

# The newest release tag of a GitHub repository, falling back to its newest
# tag when it publishes tags without releases.
github_latest_tag() {
    local repo="$1" tag
    tag="$(fetch "https://api.github.com/repos/${repo}/releases/latest" 2>/dev/null | jq -r '.tag_name // empty')" || true
    if [ -z "$tag" ]; then
        tag="$(fetch "https://api.github.com/repos/${repo}/tags?per_page=1" | jq -r '.[0].name // empty')"
    fi
    [ -n "$tag" ] || { echo "no release or tag for $repo" >&2; return 1; }
    echo "$tag"
}

# The download address of a release asset whose name matches a pattern.
github_asset_url() {
    local repo="$1" pattern="$2"
    # first() inside jq rather than `| head`: head closing the pipe early can
    # kill jq with SIGPIPE, which pipefail turns into a failed build.
    fetch "https://api.github.com/repos/${repo}/releases/latest" \
        | jq -r --arg p "$pattern" 'first(.assets[] | select(.name | test($p)) | .browser_download_url) // empty'
}

# Put a file where a package owns one, without the package putting its own
# back on the next upgrade.
divert() {
    local path="$1"
    if ! dpkg-divert --list "$path" | grep -q .; then
        dpkg-divert --local --rename --add "$path"
    fi
}
