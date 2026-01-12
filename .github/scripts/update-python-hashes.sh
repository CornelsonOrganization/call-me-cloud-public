#!/bin/bash
# Regenerate Python requirements with hashes
# Run this script locally when updating package versions
#
# Usage:
#   bash update-python-hashes.sh
#
# Prerequisites:
#   pip install pip-tools

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REQUIREMENTS_DIR="$SCRIPT_DIR/../requirements"
INPUT_FILE="$REQUIREMENTS_DIR/office-skills.in"
OUTPUT_FILE="$REQUIREMENTS_DIR/office-skills.txt"

echo "=== Updating Python Package Hashes ==="

# Check for input file
if [ ! -f "$INPUT_FILE" ]; then
    echo "ERROR: Input file not found: $INPUT_FILE"
    echo "Create the input file with package requirements first"
    exit 1
fi

# Check for pip-tools
if ! command -v pip-compile &> /dev/null; then
    echo "Installing pip-tools..."
    pip install pip-tools
fi

echo "Input file: $INPUT_FILE"
echo "Output file: $OUTPUT_FILE"
echo ""

# Generate hashed requirements
echo "Generating hashes for office-skills packages..."
pip-compile \
    --generate-hashes \
    --allow-unsafe \
    --strip-extras \
    --resolver=backtracking \
    --output-file="$OUTPUT_FILE" \
    "$INPUT_FILE"

echo ""
echo "=== Generated: $OUTPUT_FILE ==="
echo ""
echo "Package count: $(grep -c "^[a-zA-Z]" "$OUTPUT_FILE" 2>/dev/null || echo "0")"
echo ""
echo "IMPORTANT: Review the changes and commit both files:"
echo "  - $INPUT_FILE"
echo "  - $OUTPUT_FILE"
echo ""
echo "To update a package version:"
echo "  1. Edit office-skills.in with new version constraint"
echo "  2. Run this script again"
echo "  3. Review and commit both files"
