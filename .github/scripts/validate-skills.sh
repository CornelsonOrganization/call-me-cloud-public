#!/bin/bash
# Skills Configuration Validation Script
# Validates skills.yml files against JSON schema
#
# Usage:
#   bash validate-skills.sh path/to/skills.yml
#
# Exit codes:
#   0 - Valid configuration
#   1 - Validation failed or error

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCHEMA_FILE="${SCRIPT_DIR}/../schemas/skills-schema.json"
ALLOWLIST_FILE="${SCRIPT_DIR}/../config/allowed-system-deps.txt"

# Colors for output (stderr only)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[VALIDATE]${NC} $1" >&2; }
log_warn() { echo -e "${YELLOW}[VALIDATE]${NC} $1" >&2; }
log_error() { echo -e "${RED}[VALIDATE]${NC} $1" >&2; }

# Check required tools
check_dependencies() {
    local missing=()

    if ! command -v yq &>/dev/null; then
        missing+=("yq")
    fi

    if ! command -v python3 &>/dev/null; then
        missing+=("python3")
    fi

    if [ ${#missing[@]} -gt 0 ]; then
        log_error "Missing required tools: ${missing[*]}"
        log_error "Install with: sudo apt-get install -y ${missing[*]}"
        return 1
    fi
}

# Validate YAML syntax
validate_yaml_syntax() {
    local skills_file="$1"

    if ! yq '.' "$skills_file" > /dev/null 2>&1; then
        log_error "Invalid YAML syntax in: $skills_file"
        yq '.' "$skills_file" 2>&1 | head -5 >&2
        return 1
    fi

    log_info "YAML syntax valid"
}

# Validate against JSON schema
validate_schema() {
    local skills_file="$1"

    if [ ! -f "$SCHEMA_FILE" ]; then
        log_error "Schema file not found: $SCHEMA_FILE"
        return 1
    fi

    # Convert YAML to JSON
    local json_content
    json_content=$(yq -o json "$skills_file")

    # SECURITY: Pass JSON through stdin to avoid shell injection via heredoc
    # The json_content could contain malicious characters if YAML parsing doesn't sanitize
    echo "$json_content" | SCHEMA_FILE="$SCHEMA_FILE" python3 << 'EOF'
import sys
import os
import json

try:
    from jsonschema import validate, ValidationError, Draft7Validator
except ImportError:
    # SECURITY: jsonschema should be pre-installed in CI environment
    # Fail if not available rather than installing unverified packages
    print("[VALIDATE] ERROR: jsonschema not installed", file=sys.stderr)
    print("[VALIDATE] Install with: pip install jsonschema", file=sys.stderr)
    sys.exit(1)

# Load schema from environment variable path
schema_file = os.environ.get("SCHEMA_FILE")
if not schema_file:
    print("[VALIDATE] ERROR: SCHEMA_FILE not set", file=sys.stderr)
    sys.exit(1)

with open(schema_file) as f:
    schema = json.load(f)

# Parse data from stdin (safe - no shell interpolation)
data = json.load(sys.stdin)

# Validate
validator = Draft7Validator(schema)
errors = list(validator.iter_errors(data))

if errors:
    print("[VALIDATE] Schema validation failed:", file=sys.stderr)
    for error in errors[:5]:  # Show first 5 errors
        path = " -> ".join(str(p) for p in error.absolute_path) or "(root)"
        print(f"  - Path: {path}", file=sys.stderr)
        print(f"    Error: {error.message}", file=sys.stderr)
    sys.exit(1)

print("[VALIDATE] Schema validation passed", file=sys.stderr)
EOF
}

# Validate system_deps against allowlist
validate_system_deps() {
    local skills_file="$1"

    # Extract system_deps
    local deps
    deps=$(yq -r '.skills.system_deps[]? // empty' "$skills_file" 2>/dev/null || echo "")

    if [ -z "$deps" ]; then
        log_info "No system dependencies to validate"
        return 0
    fi

    if [ ! -f "$ALLOWLIST_FILE" ]; then
        log_warn "Allowlist file not found: $ALLOWLIST_FILE"
        log_warn "Skipping allowlist validation"
        return 0
    fi

    local rejected=()
    local approved=()

    while IFS= read -r dep; do
        [ -z "$dep" ] && continue

        # SECURITY: Reject deps containing whitespace or control characters
        # This prevents newline-based allowlist bypass attacks
        if [[ "$dep" =~ [[:space:]] ]] || [[ "$dep" =~ [[:cntrl:]] ]]; then
            rejected+=("$dep (contains whitespace or control characters)")
            continue
        fi

        # Check against allowlist (exact match, case-sensitive)
        if grep -qx "$dep" "$ALLOWLIST_FILE" 2>/dev/null; then
            approved+=("$dep")
        else
            rejected+=("$dep")
        fi
    done <<< "$deps"

    if [ ${#rejected[@]} -gt 0 ]; then
        log_error "System dependencies NOT on allowlist:"
        for dep in "${rejected[@]}"; do
            log_error "  - $dep"
        done
        log_error ""
        log_error "To allow these packages, add them to:"
        log_error "  $ALLOWLIST_FILE"
        return 1
    fi

    if [ ${#approved[@]} -gt 0 ]; then
        log_info "System dependencies approved: ${approved[*]}"
    fi
}

# Validate python_deps format
validate_python_deps() {
    local skills_file="$1"

    local deps
    deps=$(yq -r '.skills.python_deps[]? // empty' "$skills_file" 2>/dev/null || echo "")

    if [ -z "$deps" ]; then
        log_info "No Python dependencies to validate"
        return 0
    fi

    local invalid=()

    # Regex for valid pip requirement specifiers
    local pattern='^[a-zA-Z0-9][a-zA-Z0-9._-]*(\[.*\])?(>=|<=|==|~=|!=|>|<)?[0-9a-zA-Z.,*]*$'

    while IFS= read -r dep; do
        [ -z "$dep" ] && continue

        # SECURITY: Check for dangerous characters (shell injection prevention)
        # Includes: ; | & $ ` \ ' " ( ) ! < > newlines and control chars
        if [[ "$dep" =~ [';|&$`\\'\"()!<>] ]] || [[ "$dep" =~ [[:cntrl:]] ]]; then
            invalid+=("$dep (contains dangerous characters)")
            continue
        fi

        # Check format
        if [[ ! "$dep" =~ $pattern ]]; then
            invalid+=("$dep (invalid format)")
        fi
    done <<< "$deps"

    if [ ${#invalid[@]} -gt 0 ]; then
        log_error "Invalid Python dependencies:"
        for dep in "${invalid[@]}"; do
            log_error "  - $dep"
        done
        return 1
    fi

    log_info "Python dependencies format valid"
}

# Main validation
main() {
    local skills_file="${1:-}"

    if [ -z "$skills_file" ]; then
        log_error "Usage: $0 <skills.yml>"
        exit 1
    fi

    if [ ! -f "$skills_file" ]; then
        log_error "File not found: $skills_file"
        exit 1
    fi

    log_info "Validating: $skills_file"

    check_dependencies || exit 1
    validate_yaml_syntax "$skills_file" || exit 1
    validate_schema "$skills_file" || exit 1
    validate_system_deps "$skills_file" || exit 1
    validate_python_deps "$skills_file" || exit 1

    log_info "All validations passed"
    echo "valid"
}

main "$@"
