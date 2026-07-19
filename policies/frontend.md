# Frontend Policy

Apply this policy to Vue components, stores, routes, styling, and user interaction.

## State And Flow

- Keep one explicit source of truth for each piece of UI state.
- Prefer event and function flow over watchers. Use a watcher only when reacting to external
  reactive state is genuinely the simplest boundary.
- Do not bounce one reactive source into another with a watcher.
- Route-driven UI state follows the route; host configuration follows its owning configuration
  boundary.
- Keep Taskyon-owned interfaces in Taskyon-owned UI modules instead of duplicating them in a host
  application.

## Components And Styling

- Follow the established design system and current application style.
- Keep visual theme, color, shadow, border, and background ownership in the shared theme layer;
  component styles should focus on layout and component-specific structure.
- Reuse existing components and icon libraries before adding local substitutes.
- Pass imported SVG icon definitions, such as Quasar Extras icon constants, to icon components.
  Do not use font-ligature names such as `name="search"`; they render as text when the matching
  icon font is unavailable.
- Keep controls complete, accessible, responsive, and free of text overlap.
- Avoid unrelated visual changes in behavior-focused work.

## Runtime Boundaries

- UI code communicates with Taskyon core and external hosts through typed protocol clients.
- Do not import privileged core internals directly into reusable UI components.
- Browser-only behavior belongs in the browser host boundary, not shared core.
- Verify user-facing workflows at representative desktop and mobile sizes when layout changes.
