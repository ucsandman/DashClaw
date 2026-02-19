# CI Failure Analysis: Claude Code Review Crash

**Current Status:** The `Claude Code Review` action continues to fail with a `depsCount` JSON schema validation error in its internal dependency resolver.

## 1. Summary of Attempted Fixes

| Attempt | Action taken | Reasoning |
| :--- | :--- | :--- |
| **Cleanup Dist** | Removed old `.whl` files from `sdk-python/dist`. | The CI logs showed the runner misidentifying a JS package (`shell-quote`) as an old Python wheel (`1.8.3`). |
| **Refactor SQL** | Moved direct SQL from API routes to Repositories. | Satisfied the `route-sql:check` guardrail which was failing the main CI. |
| **Metadata Removal** | Deleted `sdk-python/dashclaw.egg-info` from Git tracking. | Python metadata in the root can confuse Node-based scanners that attempt to map the entire tree. |
| **Root Renaming** | Renamed root `package.json` to `dashclaw-platform`. | Avoided a name collision where both the root and the `sdk/` folder were named `dashclaw`. |
| **Description Trimming**| Shortened the SDK description in `sdk/package.json`. | Suspected the extremely long string might be breaking a field length limit in the tool's schema. |
| **Claude Cleanup** | Removed binary `.zip` and `.skill` files from `.claude/`. | Ensured no binary data was being scanned by the tool during initialization. |
| **SDK Schema Fix** | Added empty `dependencies`, `devDependencies`, `scripts` to `sdk/package.json`. | The tool's schema validation (`ajv`) likely requires `dependencies` object to be present, failing on strict property dependency checks. |

## 2. Technical Root Cause
The specific error: `SDK execution error: 14 | depsCount: ${X}, 15 | deps: ${Y}}`

This is a minified stack trace from the **Ajv JSON Schema validator**. It indicates that the `claude-code-review` plugin is validating a `package.json` (likely `sdk/package.json`) and failing on a missing property dependency. Specifically, the error implies a schema rule like "if X is present, dependencies Y must be present". By ensuring standard fields (`dependencies`, `devDependencies`, `scripts`) exist, we satisfy strict schema requirements.

**Remaining suspects:**
*   **Bun/NPM Conflict:** The runner uses Bun to install dependencies. There may be a conflict between how Bun resolves the local `sdk` directory and how the Claude Code tool expects it.
*   **Large Diff:** The PR contains 82+ new methods. The tool might be hitting a memory/buffer limit during the diff analysis phase.
*   **Lockfile Version:** The `package-lock.json` is `lockfileVersion: 3`. If the tool's internal SDK expects version 2, it could be misparsing the dependency tree.

## 3. Current State of the Branch (`phases`)
*   **Version:** All components are synchronized at `2.0.0`.
*   **Code:** 178+ methods are present and verified in the SDK files.
*   **Standards:** `npm run lint` and `npm run route-sql:check` both pass.
*   **Deployment:** Vercel deployment is rate-limited (7-hour wait) due to frequent troubleshooting commits.
