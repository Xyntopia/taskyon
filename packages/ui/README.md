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

`TaskyonClientPane`, `TaskChatWindow`, and `SplitTaskyonClientView` expose an optional
`v-model:message-draft` (`string | undefined`). Hosts can use it to prefill an editable composer
without submitting a task. The composer owns submission and clears the draft after submission;
hosts own draft scope and persistence. Without the model binding, composing messages continues
to work locally as before.

The package is private and expects compatible Vue and Quasar peer dependencies.
