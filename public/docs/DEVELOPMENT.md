# Taskyon Development Guide

Welcome to Taskyon development! This guide is designed to help you set up your environment and get started quickly. Taskyon is built on Vue 3 and Quasar, with a focus on clean architecture and ease of contribution. Even if you're new to the project, you'll find that adding features or working with Taskyon is simple and enjoyable.

For more detailed information about Quasar, follow this link: [Quasar Documentation](https://quasar.dev/)

## Install the Project

To get started with Taskyon, follow these steps:

```bash
# download the project
git clone https://github.com/Xyntopia/taskyon.git

# install dependencies & development dependencies
yarn install

# start development server
quasar dev

# build static webpage
quasar build
```

That's it! You can immediately start developing with Quasar/Vue3 and explore Taskyon's chat interface and task management features.

## Configuration and Local vs Production Setup

Taskyon allows for different configurations that can be saved and loaded for various environments. You can access Taskyon's settings and manage these configurations by navigating to:

```
http://localhost:9000/settings/sync
```

Here, you can define and load both **local** (development) and **production** configurations, making it easy to switch between environments.

## Building Documentation

Most docs should automatically appear inside the taskyon webpage when compiling the site with webpack. Taskyon
makes use of all markdown files in the directory `src/public/doc` for documentation. Starting with index.md.

Tasyon automatically compiles a reference for the [taskyon iframe API](https://rest.wiki/https://taskyon.space/docs/openapi-docs.yml) on every build.

Aditionally, we encourage to write code examples for taskyon using typescript
and then compile them into javascript using a command like this ([swc](https://swc.rs/) comes pre-installed with the
taskyon development environment):

```
swc --config-file src/docs/examples/swcrc exampleToolDefinition.ts -o exampleToolDefinition.js
```

## Dependency Analysis

Taskyon’s codebase is structured to maintain a clear separation between the **Quasar framework** and **Taskyon’s core logic**. This not only ensures modularity but also helps prevent circular dependencies within the project. Analyzing dependencies is crucial, and we provide two tools for this purpose:

- **Dependency Cruiser** (preferred, as it supports Vue files):

Here is one example of the structure of taskyons codebase as an interactive html:

[frontend/public/docs/dependency-cruiser-graph-flat-dot.html](frontend/public/docs/dependency-cruiser-graph-flat-dot.html)

```bash
# perform dependency analysis e.g. in order to detect circular dependencies:
depcruise src

# generate a simple visual graph:
depcruise src --include-only "^src" --output-type dot | dot -T svg > dependency-graph.svg

# generate folder level interactive overview:
depcruise src --config --output-type ddot |   dot -T svg -Grankdir=TD |   tee dependency-cruiser-dir-graph.svg | depcruise-wrap-stream-in-html > dependency-cruiser-dir-graph.html

# get a nice interactive overview of our dependencies without folder groups
depcruise src --progress \
#    --output-type flat \
    --include-only "^src" \
  | dot -Tsvg \
  | tee dependency-cruiser-graph-flat-dot.svg \
  | npx depcruise-wrap-stream-in-html \
  > dependency-cruiser-graph-flat-dot.html
```

- **Madge** (useful, but currently has issues detecting Vue file references):

```bash
madge  --image graph.svg ./src
#or
madge --circular --image graph.svg ./src
```

This analysis helps maintain a clean structure as Taskyon grows and evolves.

## Testing

Taskyon uses Cypress for end-to-end testing. All tests are located in the `./test` directory. Before merging pull requests, all tests must pass successfully. Occasionally, tests may fail for unrelated reasons, in which case developers should be contacted for further troubleshooting.

To run the tests:

```bash
cypress run --e2e
```

For a more interactive debugging experience, you can also run Cypress in open mode:

```bash
cypress open --e2e
```

Select the tests you'd like to run, and view them live as they execute.

Videos of the test runs are saved in `test/cypress/videos/` for later review.

## Code Formatting and Linting

Taskyon enforces consistent code formatting and linting across the project. Visual Studio Code should automatically apply ESLint rules when you format the document.

To manually format the code:

```bash
yarn format
# or
npm run format
```

Make sure your code is correctly formatted and linted before committing. The configuration for ESLint is integrated into the project, and Visual Studio Code will help ensure that your contributions align with the coding standards (e.g. you can press
ctrl-shift-p then search for "format" and it will give formatting options).

In VS Code, we use "prettier" for all formatting options...

## Docker

Taskyon has a docker image available. Building the image will download taskyons dependencies and build them inside the docker image.

## Nix Flake

Taskyon provides a Nix flake (flake.nix) as a development environment which can be used to provide a consistent deveopment environment for taskyon.

## Debugging

To debug Taskyon, we recommend using **Vue DevTools**, which integrates seamlessly with the development environment. You can inspect components, monitor Vuex state, and track changes in real time, ensuring efficient debugging and development workflows.

## Contribution Guidelines

Taskyon is designed to be **developer-friendly**, and we encourage contributions, especially around building new GUI features using **Quasar** and **Vue3**. Taskyon’s architecture is modular, and you’ll find that adding new functionality, like UI components or task management enhancements, is both straightforward and rewarding.

Don’t hesitate to dive in and explore the codebase. Taskyon is "meant" to be integrated into a variety of use cases, and you'll quickly discover that it’s a great starting point for building powerful, local-first AI interactions.
