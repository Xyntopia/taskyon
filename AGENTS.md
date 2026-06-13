# Agent Instructions

- Agents must read and follow `development_instructions.md` before making code changes.
- Agents must always adhere to all rules defined in `development_instructions.md`.
- Agents must fix root causes instead of symptoms: keep values strongly typed at their source and validate them there instead of widening types or adding downstream guards to silence errors.
- Agents must explicitly tell the user when a request seems like a bad idea, technically impossible, misleading, or likely to produce poor code. Do not silently comply with harmful design directions; challenge them with concrete reasoning.
- Agents must use plain English. Technical terms are fine when needed, but explanations and questions should stay simple and clear instead of sounding more abstract or complicated than necessary.
- Agents should not run `lint:fix` or broad repo-wide lint commands by default on every turn. Use targeted checks for the changed boundary, and if full lint was not run, remind the user to run it before committing.
