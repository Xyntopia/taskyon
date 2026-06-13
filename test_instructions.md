# Test Instructions

## Test/Product Boundary

- Do not tailor production Taskyon code, stores, or tools only to make a test easier.
- Prefer testing user-visible behavior through the UI, DOM, CLI output, or documented runtime APIs.
- If a test needs a hook, make it generic and dev-only. Avoid feature-specific hooks such as
  `callSpecificToolForTest` or helpers that search product internals for one widget type.
- Keep feature-specific orchestration in the test file or test support layer, not in production
  stores or components.
- Playwright tests should usually wait for rendered DOM evidence instead of subscribing to Taskyon
  task streams. For example, wait for the assistant message, iframe, canvas, widget markers, or
  other stable user-visible selectors before taking screenshots.
- Do not assert implementation details such as generated task IDs or selected-task URLs unless that
  behavior is itself the product contract being tested.
- Prefer mock external services at the network boundary. Do not require optional local env files
  such as `cypress.env.json` or `playwright.env.json` for tests that can be deterministic.
