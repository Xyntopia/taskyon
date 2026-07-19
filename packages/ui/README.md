# `@taskyon/ui`

Reusable Vue and Quasar UI owned by Taskyon.

Subpath exports provide components, pages, and UI-focused modules. Consumers import the concrete
surface they need, for example:

```ts
import DocumentationPage from '@taskyon/ui/pages/DocumentationPage.vue'
```

The package owns generic presentation and interaction components. Application-specific corpus
selection, routes, stores, provider registration, and product policy remain in the host
application.

The package is private and expects compatible Vue and Quasar peer dependencies.
