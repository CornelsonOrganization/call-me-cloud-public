# Office Skills Integration Spec

**Status:** Draft
**Author:** Claude (automated)
**Date:** 2025-01-12
**Related:** [Agent Skills Docs](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)

## Overview

This spec defines how to integrate Anthropic's official Office document skills (pptx, xlsx, docx, pdf) with the call-me-cloud GitHub Actions workflow, enabling Claude to generate professional documents during phone-assisted sessions.

## Goals

1. **Premium document generation** - Use Anthropic's production-grade Office skills
2. **Base prompt + skills binding** - Attach specific skills to base prompts
3. **Company templates** - Support custom templates per organization
4. **Zero-friction setup** - Minimal configuration for end users

## Architecture

### Directory Structure

```
call-me-cloud/
├── .github/
│   ├── base-prompts/
│   │   ├── office-mode.md          # NEW: Office specialist persona
│   │   ├── meeting-notes.md        # Existing (can use office skills)
│   │   └── ...
│   ├── prompt-skills/              # NEW: Skills bound to prompts
│   │   ├── office-mode/
│   │   │   └── skills.yml          # Skills configuration
│   │   └── meeting-notes/
│   │       └── skills.yml
│   └── workflows/
│       └── call.yml                # Modified to load skills
├── .claude/
│   ├── skills/                     # NEW: Custom project skills
│   │   └── company-templates/
│   │       ├── SKILL.md
│   │       └── templates/
│   │           ├── prd-template.docx
│   │           └── deck-template.pptx
│   └── settings.json
└── templates/                      # NEW: Document templates directory
    ├── README.md
    ├── prd/
    │   └── basic-prd.md
    └── presentations/
        └── quarterly-review.md
```

### Skills Configuration Format

Each base prompt MAY have an associated skills configuration in `.github/prompt-skills/<prompt-name>/skills.yml`:

```yaml
# .github/prompt-skills/office-mode/skills.yml
skills:
  # Official Anthropic skills (via plugin)
  plugins:
    - name: anthropics/skills
      skills:
        - docx
        - xlsx
        - pptx
        - pdf

  # Project-level custom skills (from .claude/skills/)
  project:
    - company-templates

  # System dependencies (installed via apt-get)
  system_deps:
    - libreoffice-writer    # Optional: for advanced conversions
    - poppler-utils         # Optional: for PDF tools
    - pandoc               # Optional: for format conversion

  # Python dependencies (installed via pip)
  python_deps:
    - python-docx>=0.8.11
    - openpyxl>=3.1.0
    - python-pptx>=0.6.21
    - pypdf>=3.0.0
    - pdfplumber>=0.9.0
```

### Workflow Modifications

The `call.yml` workflow MUST be modified to:

1. **Parse skills configuration** when loading base prompts
2. **Install dependencies** listed in skills.yml
3. **Configure plugin marketplace** to include anthropics/skills
4. **Enable Skill tool** in allowedTools

```yaml
# In call.yml - new step after "Load base prompt"
- name: Load prompt skills configuration
  id: prompt_skills
  run: |
    PROMPT_NAME="${{ steps.base_prompt.outputs.name }}"
    SKILLS_FILE=".github/prompt-skills/${PROMPT_NAME}/skills.yml"

    if [ -f "$SKILLS_FILE" ]; then
      # Parse and output skills configuration
      # ... (implementation details)
    fi
```

## Base Prompt: office-mode

### Purpose

An Office document specialist that helps users create professional documents through voice conversations. Optimized for:

- Meeting summaries → formal documents
- Verbal discussions → presentations
- Quick data entry → spreadsheets
- Reports and memos → PDFs

### Persona

```markdown
---
name: Office Document Specialist
description: Create professional documents from conversations
recommended_model: sonnet
skills:
  - docx
  - xlsx
  - pptx
  - pdf
---

You are an Office document specialist who creates professional
documents from voice conversations.

## Capabilities
- Word documents (docx): Reports, memos, PRDs, specs
- Excel spreadsheets (xlsx): Data analysis, tracking, budgets
- PowerPoint presentations (pptx): Decks, pitches, reviews
- PDF documents: Formal reports, invoices, contracts

## Conversation Flow
1. Understand what document the user needs
2. Ask clarifying questions about format, structure, audience
3. Draft the document using appropriate skill
4. Walk through the result verbally
5. Make revisions based on feedback
6. Save to appropriate location
```

## Custom Skills

### Company Templates Skill

Organizations can create a `company-templates` skill with their branded templates:

```markdown
---
name: company-templates
description: Apply company branding and templates to documents.
  Use when creating official company documents, using brand guidelines,
  or starting from company templates.
---

# Company Templates

## Available Templates

### PRD Template
Located at: `templates/prd/basic-prd.md`
Use for: Product requirements documents

### Quarterly Review Deck
Located at: `templates/presentations/quarterly-review.md`
Use for: Quarterly business reviews

## Brand Guidelines
- Primary color: #0066CC
- Font: Inter for body, Montserrat for headings
- Logo placement: Top-left of first page/slide

## Usage
When creating documents, always check if a company template exists
and apply brand guidelines to all outputs.
```

## Implementation Plan

### Phase 1: Core Infrastructure

1. Create `.github/prompt-skills/` directory structure
2. Define `skills.yml` schema and parser
3. Modify `setup-plugins.sh` to handle skills configuration
4. Update `call.yml` to load prompt-bound skills

### Phase 2: Office Mode

1. Create `office-mode.md` base prompt
2. Create skills configuration for office-mode
3. Add anthropics/skills to plugin marketplace
4. Test document generation via phone call

### Phase 3: Custom Templates

1. Create `.claude/skills/company-templates/` structure
2. Add example templates
3. Document template creation process
4. Test template application

### Phase 4: Meeting Notes Integration

1. Update `meeting-notes.md` to optionally use office skills
2. Create workflow: transcript → PRD document
3. Test end-to-end meeting → document flow

## Dependencies

### Required

| Dependency | Purpose | Install Method |
|------------|---------|----------------|
| anthropics/skills plugin | Official Office skills | Plugin marketplace |
| Skill tool enabled | Invoke skills | allowedTools config |

### Optional (for advanced features)

| Dependency | Purpose | Install Time |
|------------|---------|--------------|
| LibreOffice | DOC→DOCX conversion | ~2 min |
| Poppler | PDF utilities | ~30 sec |
| Pandoc | Format conversion | ~30 sec |

## API Reference

### Skills Configuration Schema

```typescript
interface SkillsConfig {
  skills: {
    // Official plugins to load
    plugins?: Array<{
      name: string;           // e.g., "anthropics/skills"
      skills?: string[];      // Specific skills to enable
    }>;

    // Project skills from .claude/skills/
    project?: string[];

    // System dependencies (apt-get)
    system_deps?: string[];

    // Python dependencies (pip)
    python_deps?: string[];
  };
}
```

### Workflow Inputs

The `call.yml` workflow already supports:

- `base_prompt`: Selects the persona and bound skills
- `additional_plugins`: Extra plugins beyond prompt defaults

New behavior:
- Loading `office-mode` automatically includes anthropics/skills plugin
- Skills configuration merges with `additional_plugins`

## Security Considerations

1. **Plugin verification** - Only load plugins from trusted marketplaces
2. **Template sanitization** - Templates MUST NOT contain executable macros
3. **File access** - Skills operate within the repository sandbox
4. **Network access** - Official skills may require network for code execution container

## Testing

### Unit Tests

1. Skills configuration parser
2. Dependency installation scripts
3. Plugin loading logic

### Integration Tests

1. Office-mode prompt loads correct skills
2. Document generation produces valid files
3. Templates are correctly applied

### End-to-End Tests

1. Phone call → verbal requirements → document created
2. Meeting transcript → PRD document
3. Data discussion → Excel spreadsheet

## Open Questions

1. **Caching**: Should we cache installed dependencies between runs?
2. **Template versioning**: How to handle template updates?
3. **Skill composition**: Can skills inherit from other skills?

## References

- [Agent Skills Overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [Agent Skills in SDK](https://platform.claude.com/docs/en/agent-sdk/skills)
- [Skills Quickstart](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/quickstart)
- [anthropics/skills Repository](https://github.com/anthropics/skills)
