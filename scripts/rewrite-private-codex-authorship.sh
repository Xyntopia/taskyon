#!/usr/bin/env bash
set -euo pipefail

mapfile -t private_refs < <(
  git for-each-ref \
    --format='%(if)%(symref)%(then)%(else)%(refname)%(end)' \
    refs/remotes/origin refs/remotes/shared |
    sed '/^$/d'
)

mapfile -t public_refs < <(
  git for-each-ref \
    --format='%(if)%(symref)%(then)%(else)%(refname)%(end)' \
    refs/remotes/github |
    sed '/^$/d'
)
public_refs+=(refs/tags/0.01 refs/tags/quasar1)

[[ ${#private_refs[@]} -gt 0 && ${#public_refs[@]} -gt 2 ]]
declare -A public_tips=()
for public_ref in "${public_refs[@]}"; do
  git rev-parse --verify "$public_ref" >/dev/null
  public_tips["$public_ref"]="$(git rev-parse "$public_ref")"
done

FILTER_BRANCH_SQUELCH_WARNING=1 \
  git filter-branch \
    --env-filter '
      case "${GIT_AUTHOR_NAME}:${GIT_AUTHOR_EMAIL}" in
        Codex:*|codex:*|*:codex@*)
          GIT_AUTHOR_NAME="yeus"
          GIT_AUTHOR_EMAIL="yeusblender@gmail.com"
          export GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL
          ;;
      esac

      case "${GIT_COMMITTER_NAME}:${GIT_COMMITTER_EMAIL}" in
        Codex:*|codex:*|*:codex@*)
          GIT_COMMITTER_NAME="yeus"
          GIT_COMMITTER_EMAIL="yeusblender@gmail.com"
          export GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL
          ;;
      esac
    ' \
    -- \
    "${private_refs[@]}" \
    --not "${public_refs[@]}"

for public_ref in "${public_refs[@]}"; do
  [[ $(git rev-parse "$public_ref") == "${public_tips[$public_ref]}" ]]
done

for private_ref in "${private_refs[@]}"; do
  original_ref="refs/original/$private_ref"
  git show-ref --verify --quiet "$original_ref" || continue

  git diff --quiet "$original_ref" "$private_ref" --
  [[ $(git rev-list --count "$original_ref" --not "${public_refs[@]}") -eq \
    $(git rev-list --count "$private_ref" --not "${public_refs[@]}") ]]
  [[ $(git rev-list --count --min-parents=2 "$original_ref" --not "${public_refs[@]}") -eq \
    $(git rev-list --count --min-parents=2 "$private_ref" --not "${public_refs[@]}") ]]
done

remaining="$({
  git log "${private_refs[@]}" --not "${public_refs[@]}" \
    --format='%aN <%aE> %cN <%cE>' |
    grep -Ei '(^| )Codex <|codex@' || true
} | wc -l)"

[[ $remaining -eq 0 ]]
echo "Rewrote private GitLab refs; public GitHub refs were excluded."
echo "Original tips are available under refs/original/."
