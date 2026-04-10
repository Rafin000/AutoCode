/**
 * Import every step executor so they register themselves via
 * registerStep() at module load time.
 *
 * This file must be imported once at CLI startup (from index.ts)
 * before any pipeline is run. Adding a new step type is just:
 *   1. Create src/workflow/steps/my_step.ts
 *   2. Add an import here
 *   3. The engine picks it up automatically
 */

import "./steps/retrieve_context.js";
import "./steps/llm_generate.js";
import "./steps/save_draft.js";
import "./steps/human_review.js";
