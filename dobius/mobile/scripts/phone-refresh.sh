#!/bin/zsh
# Rebuilds, re-signs and reinstalls Dobius on Carson's iPhone before the
# free-Apple-ID 7-day provisioning profile expires. Run daily by launchd
# (~/Library/LaunchAgents/com.verlosolutions.dobius.phone-refresh.plist);
# only does work once the last successful install is 6+ days old.
# Usage: phone-refresh.sh [--force]
set -u

DEVICE_ID="${DOBIUS_IPHONE:-760A86B6-BC60-5F48-A098-3E588854D71A}"
BUNDLE_ID="com.verlosolutions.dobius"
IOS_DIR="/Volumes/Storage/dev/dobius/dobius/mobile/ios"
BUILD_DIR="/Volumes/Storage/dev/xcode-device-build"
APP="$BUILD_DIR/Build/Products/Debug-iphoneos/Dobius.app"
STATE="/Volumes/Storage/dev/phone-refresh.last-install"
LOG="/Volumes/Storage/dev/phone-refresh.log"
REFRESH_AFTER_SECONDS=$((6 * 24 * 3600))

notify() {
  osascript -e "display notification \"$1\" with title \"Dobius phone refresh\"" >/dev/null 2>&1
  echo "$(date '+%F %T') $1" >> "$LOG"
}

fail() {
  notify "FAILED: $1 (see $LOG)"
  exit 1
}

[[ -d "$IOS_DIR" ]] || fail "Storage drive not mounted"

if [[ "${1:-}" != "--force" && -f "$STATE" ]]; then
  age=$(( $(date +%s) - $(cat "$STATE") ))
  if (( age < REFRESH_AFTER_SECONDS )); then
    echo "$(date '+%F %T') skip: last install $((age / 3600))h ago" >> "$LOG"
    exit 0
  fi
fi

# Why: devicectl can't install on this iPhone (Xcode's DDI lacks its chip);
# pymobiledevice3's installation_proxy needs no DDI.
PMD="/Volumes/Storage/dev/pmd3-venv/bin/pymobiledevice3"
"$PMD" usbmux list 2>/dev/null | grep -q '"ProductType": "iPhone' \
  || fail "iPhone not reachable — plug it in or join the same Wi-Fi with the Mac awake"

cd "$IOS_DIR" || fail "cannot cd to $IOS_DIR"
LANG=en_US.UTF-8 xcodebuild -workspace Dobius.xcworkspace -scheme Dobius -configuration Debug \
  -destination 'generic/platform=iOS' -derivedDataPath "$BUILD_DIR" \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration build >> "$LOG" 2>&1 \
  || fail "build failed"

IPA="/Volumes/Storage/dev/Dobius.ipa"
STAGE=$(mktemp -d /Volumes/Storage/dev/ipa-stage.XXXX)
mkdir -p "$STAGE/Payload" && cp -R "$APP" "$STAGE/Payload/" && (cd "$STAGE" && rm -f "$IPA" && zip -qry "$IPA" Payload)
rm -rf "$STAGE"
"$PMD" apps install "$IPA" >> "$LOG" 2>&1 || fail "install failed"

date +%s > "$STATE"
notify "Dobius refreshed on your iPhone — good for 7 more days"
