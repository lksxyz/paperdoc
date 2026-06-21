#!/bin/bash
set -e

# Paperdoc AppImage Build Script
# Builds a self-contained AppImage for Linux

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/build"
APPDIR="$BUILD_DIR/AppDir"
APPNAME="Paperdoc"

# Versions
BUN_VERSION="1.1.38"
APPIMAGETOOL_URL="https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage"

echo "═══════════════════════════════════════"
echo "  Building $APPNAME AppImage"
echo "═══════════════════════════════════════"

# Clean previous build
rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/bin"
mkdir -p "$APPDIR/usr/share/paperdoc"
mkdir -p "$APPDIR/usr/share/applications"
mkdir -p "$APPDIR/usr/share/icons/hicolor/256x256/apps"

echo ""
echo "  [1/5] Installing dependencies..."
cd "$PROJECT_DIR"
if [ ! -d "node_modules" ]; then
  pnpm install
fi

echo ""
echo "  [2/5] Copying application files..."
# Copy source
rsync -a --exclude='node_modules' --exclude='.git' --exclude='build' \
  "$PROJECT_DIR/src/" "$APPDIR/usr/share/paperdoc/src/"

# Copy package.json
cp "$PROJECT_DIR/package.json" "$APPDIR/usr/share/paperdoc/"
cp "$PROJECT_DIR/tsconfig.json" "$APPDIR/usr/share/paperdoc/"

# Copy docs
cp -r "$PROJECT_DIR/docs/" "$APPDIR/usr/share/paperdoc/docs/"

# Copy web assets
cp -r "$PROJECT_DIR/src/web/" "$APPDIR/usr/share/paperdoc/web/"

echo ""
echo "  [3/5] Bundling Bun runtime..."
BUN_PATH="$APPDIR/usr/bin/bun"
if [ ! -f "$BUN_PATH" ]; then
  curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/bun-linux-x64-baseline.zip" -o "$BUILD_DIR/bun.zip"
  unzip -q "$BUILD_DIR/bun.zip" -d "$BUILD_DIR"
  cp "$BUILD_DIR/bun-linux-x64-baseline/bun" "$BUN_PATH"
  chmod +x "$BUN_PATH"
  rm -rf "$BUILD_DIR/bun.zip" "$BUILD_DIR/bun-linux-x64-baseline"
fi

echo ""
echo "  [4/5] Installing production dependencies in AppDir..."
cd "$APPDIR/usr/share/paperdoc"
"$BUN_PATH" install --production

echo ""
echo "  [5/5] Creating launcher and desktop entry..."

# Create AppRun launcher
cat > "$APPDIR/AppRun" << 'EOF'
#!/bin/bash
APPDIR="$(dirname "$(readlink -f "$0")")"
export PATH="$APPDIR/usr/bin:$PATH"
export PAPERDOC_APPDIR="$APPDIR"

# Check for FFmpeg
if ! command -v ffmpeg &> /dev/null; then
  echo ""
  echo "  ✖ FFmpeg is not installed on your system."
  echo ""
  echo "  Paperdoc requires FFmpeg for audio processing."
  echo "  Install it with:"
  echo ""
  echo "    Debian/Ubuntu: sudo apt install ffmpeg"
  echo "    Fedora:        sudo dnf install ffmpeg"
  echo "    Arch:          sudo pacman -S ffmpeg"
  echo ""
  read -p "  Press Enter to exit..."
  exit 1
fi

# Run Paperdoc
exec "$APPDIR/usr/bin/bun" run "$APPDIR/usr/share/paperdoc/src/cli.ts" "$@"
EOF
chmod +x "$APPDIR/AppRun"

# Create desktop entry
cat > "$APPDIR/usr/share/applications/paperdoc.desktop" << EOF
[Desktop Entry]
Name=Paperdoc
Comment=Medical Scribe AI — Local-first SOAP note generation
Exec=paperdoc
Icon=paperdoc
Type=Application
Categories=Medical;Office;
Terminal=true
EOF

# Copy desktop entry to root
cp "$APPDIR/usr/share/applications/paperdoc.desktop" "$APPDIR/paperdoc.desktop"

# Create a simple icon placeholder
cat > "$APPDIR/usr/share/icons/hicolor/256x256/apps/paperdoc.svg" << 'EOF'
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="48" fill="#4a7c59"/>
  <text x="128" y="160" font-size="140" text-anchor="middle" fill="white" font-family="serif">◈</text>
</svg>
EOF
ln -sf "usr/share/icons/hicolor/256x256/apps/paperdoc.svg" "$APPDIR/paperdoc.svg"

echo ""
echo "  Building AppImage..."

# Download appimagetool if needed
APPIMAGETOOL="$BUILD_DIR/appimagetool"
if [ ! -f "$APPIMAGETOOL" ]; then
  curl -fsSL "$APPIMAGETOOL_URL" -o "$APPIMAGETOOL"
  chmod +x "$APPIMAGETOOL"
fi

# Build the AppImage
ARCH=x86_64 "$APPIMAGETOOL" "$APPDIR" "$BUILD_DIR/Paperdoc-x86_64.AppImage"

echo ""
echo "═══════════════════════════════════════"
echo "  Build complete!"
echo ""
echo "  Output: $BUILD_DIR/Paperdoc-x86_64.AppImage"
echo ""
echo "  Usage:"
echo "    ./Paperdoc-x86_64.AppImage run"
echo "    ./Paperdoc-x86_64.AppImage download-model"
echo "═══════════════════════════════════════"
