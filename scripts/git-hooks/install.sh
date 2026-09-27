#!/bin/sh
#
# Install the repository's git hooks. Run once per clone:
#
#   sh scripts/git-hooks/install.sh
#
# The hook lives in the repo rather than in .git/hooks so it is versioned and
# reviewable; .git/hooks is not tracked by git.

set -e

repo_root=$(git rev-parse --show-toplevel)
hooks_dir="$repo_root/.git/hooks"

if [ ! -d "$hooks_dir" ]; then
  echo "No .git/hooks directory — is this a git repository?"
  exit 1
fi

cp "$repo_root/scripts/git-hooks/pre-commit" "$hooks_dir/pre-commit"
chmod +x "$hooks_dir/pre-commit"

echo "Installed pre-commit hook -> $hooks_dir/pre-commit"
echo "It blocks committing real credentials to tracked template files."
