#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FACTORY_HOME="${FACTORY_HOME:-$HOME/.factory}"

echo "Installing Continuous Factory to $FACTORY_HOME"

# Create runtime directories
mkdir -p "$FACTORY_HOME"/{bin,runs/archive,memory,manifests,metrics,queue,retros,programs,artifacts,temp,sessions,logs}

# Symlink scripts
for script in "$SCRIPT_DIR"/bin/factory-*.sh; do
  ln -sf "$script" "$FACTORY_HOME/bin/$(basename "$script")"
done

# Symlink skills
mkdir -p "$HOME/.claude/skills"
ln -sfn "$SCRIPT_DIR/skills/factory-planner" "$HOME/.claude/skills/factory-planner"
ln -sfn "$SCRIPT_DIR/skills/factory-retro" "$HOME/.claude/skills/factory-retro"

# Copy config template if no config exists
if [ ! -f "$FACTORY_HOME/config.sh" ]; then
  cp "$SCRIPT_DIR/config/config.sh.template" "$FACTORY_HOME/config.sh"
  echo "Created $FACTORY_HOME/config.sh from template — edit it with your repos and tokens"
fi

# Add FACTORY_HOME to shell profile if not already there
SHELL_RC="$HOME/.zshrc"
[ -f "$HOME/.bashrc" ] && [ ! -f "$HOME/.zshrc" ] && SHELL_RC="$HOME/.bashrc"
if ! grep -q "FACTORY_HOME" "$SHELL_RC" 2>/dev/null; then
  echo "" >> "$SHELL_RC"
  echo "# Continuous Factory" >> "$SHELL_RC"
  echo "export FACTORY_HOME=\"$FACTORY_HOME\"" >> "$SHELL_RC"
  echo "export PATH=\"\$FACTORY_HOME/bin:\$PATH\"" >> "$SHELL_RC"
  echo "Added FACTORY_HOME to $SHELL_RC"
fi

echo "Done! Run 'source $SHELL_RC' then edit $FACTORY_HOME/config.sh"
