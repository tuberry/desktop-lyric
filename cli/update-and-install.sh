#!/bin/bash
# Quick update translations and install Desktop Lyric extension

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Navigate to project root (parent directory if script is in cli/)
if [[ "$SCRIPT_DIR" == */cli ]]; then
    cd "$SCRIPT_DIR/.."
else
    cd "$SCRIPT_DIR"
fi

echo "========================================="
echo "Desktop Lyric - Update & Install"
echo "========================================="
echo ""

# 1. Update translation file line numbers
echo "📝 Updating translation files..."
ninja -C build gnome-shell-extension-desktop-lyric-update-po
echo "✅ Translation files updated"
echo ""

# 2. Compile
echo "🔨 Compiling extension..."
meson compile -C build
echo "✅ Compilation complete"
echo ""

# 3. Install
echo "📦 Installing extension..."
meson install -C build
echo "✅ Installation complete"
echo ""

echo "========================================="
echo "🎉 All done!"
echo "========================================="
echo ""
echo "Next steps:"
echo "  - X11: Press Alt+F2, type 'r' to restart GNOME Shell"
echo "  - Wayland: Log out and log back in"
echo ""
