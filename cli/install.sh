#!/bin/bash
# SPDX-FileCopyrightText: NowLoadY
# SPDX-License-Identifier: GPL-3.0-or-later
# Quick compile and install Desktop Lyric extension

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Navigate to project root (parent directory if script is in cli/)
if [[ "$SCRIPT_DIR" == */cli ]]; then
    cd "$SCRIPT_DIR/.."
else
    cd "$SCRIPT_DIR"
fi

# 1. Update translation file line numbers
# echo "📝 Updating translation files..."
# ninja -C build gnome-shell-extension-desktop-lyric-update-po
# echo "✅ Translation files updated"
# echo ""

# 2. Compile
echo "🔨 Compiling extension..."
meson compile -C build
echo "✅ Compilation complete"
echo ""

# 3. Install
echo "📦 Installing extension..."
meson install -C build
echo "✅ Installation complete"
echo "🎉 All done!"
