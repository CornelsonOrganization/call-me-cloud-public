#!/bin/bash
# Test script for plugin setup - can be run locally

set -euo pipefail

# Cleanup function
cleanup() {
    [ -n "${GITHUB_OUTPUT:-}" ] && [ -f "$GITHUB_OUTPUT" ] && rm -f "$GITHUB_OUTPUT"
}
trap cleanup EXIT

echo "=== Testing Plugin Setup Script ==="

# Create temporary GITHUB_OUTPUT file
export GITHUB_OUTPUT
GITHUB_OUTPUT=$(mktemp)
echo "Using temp output file: $GITHUB_OUTPUT"

# Run the plugin setup script
echo ""
echo "Running setup-plugins.sh..."
bash "$(dirname "$0")/setup-plugins.sh" . ""

echo ""
echo "=== Script Output ==="
cat "$GITHUB_OUTPUT"

echo ""
echo "=== Validation ==="

# Extract plugin count
PLUGIN_COUNT=$(grep "^PLUGIN_COUNT=" "$GITHUB_OUTPUT" | cut -d= -f2)
echo "Plugin count: $PLUGIN_COUNT"

# Extract marketplace (handles URLs with = in query params)
PLUGIN_MARKETPLACE=$(grep "^PLUGIN_MARKETPLACE=" "$GITHUB_OUTPUT" | sed 's/^PLUGIN_MARKETPLACE=//')
echo "Marketplace: $PLUGIN_MARKETPLACE"

# Extract plugin names (find the dynamic delimiter and extract between)
# The format is PLUGIN_NAMES<<DELIMITER ... DELIMITER
DELIMITER=$(grep "^PLUGIN_NAMES<<" "$GITHUB_OUTPUT" | sed 's/^PLUGIN_NAMES<<//')
if [ -n "$DELIMITER" ]; then
    PLUGIN_NAMES=$(sed -n "/^PLUGIN_NAMES<<${DELIMITER}$/,/^${DELIMITER}$/p" "$GITHUB_OUTPUT" | \
                   grep -v "^PLUGIN_NAMES<<" | grep -v "^${DELIMITER}$")
else
    echo "ERROR: Could not find PLUGIN_NAMES delimiter"
    exit 1
fi

echo "Plugins:"
echo "$PLUGIN_NAMES" | while read -r line; do
    [ -n "$line" ] && echo "  - $line"
done

# Validate format
echo ""
echo "=== Format Validation ==="

# Check that all plugin names end with @claude-plugins-official
if echo "$PLUGIN_NAMES" | grep -v "^$" | grep -qv "@claude-plugins-official$"; then
    echo "ERROR: Some plugins don't have correct marketplace suffix"
    echo "$PLUGIN_NAMES" | grep -v "@claude-plugins-official$"
    exit 1
else
    echo "All plugins have correct marketplace suffix"
fi

# Check for suspicious content (ANSI codes, log fragments)
if echo "$PLUGIN_NAMES" | grep -qE '\[0;3[0-9]m|\[INFO\]|\[WARN\]|\[ERROR\]|Detecting|language'; then
    echo "ERROR: Plugin names contain log fragments or ANSI codes"
    echo "$PLUGIN_NAMES" | head -10
    exit 1
else
    echo "No log contamination detected"
fi

# Check plugin count is reasonable
ACTUAL_COUNT=$(echo "$PLUGIN_NAMES" | grep -v "^$" | wc -l | tr -d ' ')
if [ "$ACTUAL_COUNT" -ne "$PLUGIN_COUNT" ]; then
    echo "ERROR: Plugin count mismatch (reported: $PLUGIN_COUNT, actual: $ACTUAL_COUNT)"
    exit 1
else
    echo "Plugin count matches (reported: $PLUGIN_COUNT, actual: $ACTUAL_COUNT)"
fi

# Check that count is in reasonable range (4 core + 0-10 detected)
if [ "$PLUGIN_COUNT" -lt 4 ] || [ "$PLUGIN_COUNT" -gt 20 ]; then
    echo "WARNING: Plugin count outside expected range (4-20): $PLUGIN_COUNT"
fi

echo ""
echo "=== All Tests Passed ==="
