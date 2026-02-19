# Prompt Management

DashClaw provides a built-in prompt template registry with immutable versioning, rendering, and usage tracking. This allows you to manage the prompts your agents use without hardcoding them in your agent's source code.

## Key Features

- **Template Registry**: Group prompts by category (general, system, agent, tool, evaluation).
- **Immutable Versioning**: Every change creates a new version. Versions are immutable once created.
- **Active Version Control**: One-click activation. Your agent always pulls the "active" version unless a specific ID is requested.
- **Variable Rendering**: Uses simple `{{mustache}}` syntax for variable replacement.
- **Usage Tracking**: Track which agents are using which prompts, token usage, and latency.
- **SDK Support**: Full support in both Node.js and Python SDKs.

## Data Model

### Prompt Templates
The top-level container for a specific prompt's lifecycle.
- `name`: Unique name for the template.
- `description`: What the prompt is for.
- `category`: Categorization for organization.

### Prompt Versions
Immutable snapshots of the prompt content.
- `version`: Sequential integer.
- `content`: The raw prompt text with `{{variables}}`.
- `model_hint`: Suggested model (e.g., `gpt-4o`).
- `parameters`: Auto-extracted list of variables found in content.
- `is_active`: Boolean flag indicating which version is currently live.

### Prompt Runs
Audit trail of prompt usage.
- `input_vars`: The variables passed for rendering.
- `rendered`: The final text sent to the LLM.
- `tokens_used`: Consumption metrics.
- `latency_ms`: Execution time.
- `outcome`: Success/failure of the resulting LLM call.

## SDK Usage

### Rendering a Prompt

```javascript
const { rendered, version_id } = await claw.renderPrompt({
  template_id: 'pt_decision_analysis',
  variables: {
    agent_name: 'ClawdBot',
    action_type: 'deploy'
  },
  record: true // Automatically create a Prompt Run record
});
```

### Managing Templates

```javascript
// Create a new template
const template = await claw.createPromptTemplate({
  name: 'Code Reviewer',
  category: 'agent'
});

// Create a version
await claw.createPromptVersion(template.id, {
  content: 'Review this: {{code}}',
  changelog: 'Initial prompt'
});
```

## UI Guide

The **Prompts** page (`/prompts`) contains two tabs:

1.  **Templates**: The registry view.
    -   **Left Panel**: List of all templates with category filters.
    -   **Right Panel**: Detail view for the selected template.
        -   Manage versions.
        -   Activate/Deactivate versions.
        -   **Preview Render**: Test your prompt with sample JSON variables instantly in the UI.
2.  **Usage**: A chronological log of recent prompt runs across all agents.

## Stats & Analytics

DashClaw provides aggregate statistics for prompts:
- **Total Runs**: Lifetime usage.
- **Avg Tokens**: Mean cost per render.
- **Unique Templates**: Breadth of registry usage.
- **Usage by Template**: Identify your most-used (and most expensive) prompts.
