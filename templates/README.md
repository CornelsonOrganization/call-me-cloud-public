# Document Templates

This directory contains templates for document generation with the office-mode persona.

## Directory Structure

```
templates/
├── prd/                    # Product Requirements Documents
│   └── basic-prd.md        # Basic PRD template
├── presentations/          # PowerPoint templates
│   └── quarterly-review.md # Quarterly review structure
└── README.md               # This file
```

## Using Templates

When using the `office-mode` base prompt, Claude will check this directory for relevant templates before creating documents.

### Template Format

Templates are written in Markdown with placeholder sections. Claude interprets these and generates the appropriate Office document format (docx, pptx, etc.).

### Adding Custom Templates

1. Create a new `.md` file in the appropriate subdirectory
2. Use clear section headings
3. Include placeholder text showing expected content
4. Document any required inputs at the top of the template

### Example Usage

```
User: "Create a PRD for our new authentication feature"
Claude: [Checks templates/prd/ for relevant template]
Claude: [Uses basic-prd.md structure]
Claude: [Generates docx with authentication feature details]
```

## Template Guidelines

- Keep templates focused on structure, not content
- Use [PLACEHOLDER] markers for variable content
- Include brief instructions for each section
- Maintain consistent formatting across templates
