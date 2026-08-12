# Frontend Policy

Apply this policy to Vue components, stores, routes, styling, and user interaction.

## State And Flow

- Keep one explicit source of truth for each piece of UI state.
- Persist reusable widget presentation state as a typed configuration object owned by the host
  workspace or layout store. The composition-level parent reads and updates that object; reusable
  widgets receive only their relevant configuration and emit explicit changes.
- Do not import an application-wide store into a reusable widget or pane. Inject narrow typed
  state and actions through props, events, or a published client contract. Store imports belong at
  the page, layout, workspace host, or another explicit composition boundary.
- Separate durable presentation preferences from transient interaction state. Persist stable user
  choices such as view mode and layout algorithm; keep selection, search text, filters, camera
  position, and temporary visibility local unless the product explicitly requires restoration.
- Keep automatically persisted personal widget state separate from explicitly versioned project
  presentation. Saving a workspace, dashboard, or sandboxed view into a project creates a typed,
  namespaced extension and a new project revision; ordinary dragging and resizing must not advance
  the project ref.
- Keep project undo/redo on the lightweight local working draft and bound it by a configurable
  history limit. Do not mix execution runs or automatically persisted personal widget state into
  project undo.
- Show invocation definitions as a distinct graph category, collapsed by default and expandable for
  planning details. Load invocation runs only as an optional execution overlay; keep invisible
  runtime-derived cache operations out of ordinary graph views.
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
