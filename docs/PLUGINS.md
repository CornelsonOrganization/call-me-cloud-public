# Claude Code Plugin System

The call-me-cloud GitHub Actions workflow includes a three-tier plugin loading system that automatically configures Claude Code with relevant capabilities.

## Three-Tier Architecture

### Tier 1: Core Plugins (Always Loaded)

These plugins are loaded for every workflow run:

- **code-review** - General code review and feedback
- **pr-review-toolkit** - Pull request review tools
- **security-guidance** - Security best practices
- **agent-sdk-dev** - Agent SDK development tools

### Tier 2: Auto-Detected Language LSPs

The system automatically scans your repository and loads Language Server Protocol (LSP) plugins based on detected file extensions:

| Language | Plugin | File Extensions |
|----------|--------|----------------|
| TypeScript/JavaScript | `typescript-lsp` | `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs` |
| Python | `pyright-lsp` | `.py`, `.pyi` |
| Go | `gopls-lsp` | `.go` |
| Rust | `rust-analyzer-lsp` | `.rs` |
| Java | `jdtls-lsp` | `.java` |
| C/C++ | `clangd-lsp` | `.c`, `.cpp`, `.cc`, `.cxx`, `.h`, `.hpp` |
| C# | `csharp-lsp` | `.cs` |
| Kotlin | `kotlin-lsp` | `.kt`, `.kts` |
| Swift | `swift-lsp` | `.swift` |
| PHP | `php-lsp` | `.php` |
| Lua | `lua-lsp` | `.lua` |

**Benefits:**
- Significantly faster code navigation
- Jump to definitions
- Find references
- See type errors immediately after edits

### Tier 3: Optional Additional Plugins

You can specify additional plugins via the workflow input parameter.

## Usage

### Basic Usage (Default Configuration)

No configuration needed! Just trigger the workflow with your prompt:

```bash
gh workflow run call.yml \
  --repo OWNER/REPO \
  -f prompt="Review the authentication logic"
```

The system will automatically:
1. Load core plugins
2. Detect your repository's languages and load relevant LSPs
3. Configure Claude Code with all detected capabilities

### Advanced Usage: Custom Plugins

To add specific plugins beyond the defaults, use the `additional_plugins` parameter:

```bash
gh workflow run call.yml \
  --repo OWNER/REPO \
  -f prompt="Redesign the frontend UI" \
  -f additional_plugins="frontend-design,hookify,explanatory-output-style"
```

**Available Additional Plugins:**

| Plugin | Description |
|--------|-------------|
| `frontend-design` | Production-grade frontend interfaces |
| `hookify` | React hooks transformation |
| `code-simplifier` | Code simplification assistance |
| `explanatory-output-style` | Detailed explanation formatting |
| `learning-output-style` | Interactive learning mode |
| `ralph-loop` | Loop optimization/refactoring |
| `plugin-dev` | Plugin development utilities |
| `feature-dev` | Feature development assistance |
| `commit-commands` | Git commit command enhancements |

### Via GitHub UI

When manually triggering the workflow from GitHub Actions:

1. Navigate to **Actions** > **Call** workflow
2. Click **Run workflow**
3. Fill in the form:
   - **prompt**: What Claude should work on
   - **additional_plugins** *(optional)*: Comma-separated plugin names
   - Other parameters as needed
4. Click **Run workflow**

## How It Works

### Plugin Selection Process

1. **Core Loading** - 4 essential plugins always load first
2. **Language Detection** - Repository is scanned for file extensions
3. **LSP Selection** - Matching LSP plugins are added to the load list
4. **Custom Addition** - User-specified plugins from `additional_plugins` input
5. **Deduplication** - List is deduplicated to avoid loading plugins twice
6. **Validation** - Each plugin is validated against the official Anthropic repository
7. **Configuration** - Valid plugins are passed to `claude-code-action`

### Plugin Installation

Plugins are sourced from the official [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) repository and installed automatically during workflow execution.

## Performance Considerations

### Context Overhead

Each plugin consumes context tokens at session start. The three-tier system balances capability with efficiency:

- **Core plugins** (4): Approximate baseline overhead
- **Detected LSPs** (varies): Additional overhead per language
- **Additional plugins** (user-defined): Varies by plugin complexity

**Note:** Exact token counts depend on plugin implementation. Monitor your Claude usage if context limits are a concern.

**Recommendation:** Only add Tier 3 plugins when needed for specific tasks to minimize context overhead.

### Initialization Time

- **Plugin cloning**: ~5-10 seconds
- **Language detection**: ~1-2 seconds
- **Validation**: ~1-2 seconds
- **Total overhead**: ~10-15 seconds per workflow run

## Debugging

To see which plugins were configured for a workflow run:

1. Navigate to the workflow run in GitHub Actions
2. Expand the **"Display configured plugins"** step
3. Review the list of loaded plugins

Example output:
```
Configured Plugins (7)
  - code-review@claude-plugins-official
  - pr-review-toolkit@claude-plugins-official
  - security-guidance@claude-plugins-official
  - agent-sdk-dev@claude-plugins-official
  - typescript-lsp@claude-plugins-official
  - pyright-lsp@claude-plugins-official
  - gopls-lsp@claude-plugins-official
```

## Troubleshooting

### Plugin Not Found Error

If you see an error about a plugin not being found:

1. Check that the plugin name is correct (case-sensitive)
2. Verify the plugin exists in [anthropics/claude-plugins-official/plugins](https://github.com/anthropics/claude-plugins-official/tree/main/plugins)
3. Ensure there are no typos in the `additional_plugins` parameter

### No Plugins Detected

If no LSP plugins are being detected:

1. Verify your repository contains source code files (not just config files)
2. Check the **"Setup Claude Code plugins"** step for detected languages
3. Ensure files are not excluded by the detection logic (e.g., in `node_modules/`)

### Plugin Installation Timeout

If plugin cloning times out:

1. Check GitHub Actions runner network connectivity
2. Verify the official plugins repository is accessible
3. Consider reducing the number of additional plugins

### Local Testing on macOS

The plugin scripts require Bash 4.0+ for associative arrays. macOS ships with Bash 3.2 by default. To test locally on macOS:

1. Install a newer Bash: `brew install bash`
2. Run tests with the newer Bash: `/opt/homebrew/bin/bash .github/scripts/test-plugins.sh`

This is only needed for local testing - GitHub Actions runs on Linux with Bash 4+.

## Architecture

The plugin system consists of:

- **`.github/scripts/setup-plugins.sh`** - Core plugin detection and configuration logic
- **`.github/scripts/test-plugins.sh`** - Local test suite for validation
- **`.github/workflows/call.yml`** - Workflow integration and parameter passing
- **Official Plugin Marketplace** - [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)

## References

- [Claude Code Plugin Documentation](https://code.claude.com/docs/en/plugins)
- [Official Plugins Repository](https://github.com/anthropics/claude-plugins-official)
- [Claude Agent SDK - Plugins](https://platform.claude.com/docs/en/agent-sdk/plugins)
