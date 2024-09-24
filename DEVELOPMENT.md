# Taskyon

Taskyon is built on Vue3/Quasar and follows most of its best practices.

For more information follow this link: [quasar documentation](https://quasar.dev/)

## Install the project

download the project from github:

```bash
# download
git clone https://github.com/Xyntopia/taskyon.git

# install dependencies
yarn install

# start development server
quasar dev

# build static webpage
quasar build
```

## Analyze taskyons dependency graph

There are two tools available:

- [madge](https://github.com/pahen/madge/tree/master)
- dependency-cruiser

both are already specified in package.json and installed with `yarn install`

### for dependency cruiser:

We prefer this method, because it supports vue-files out-of-the-box.

```
depcruise src --include-only "^src" --output-type dot | dot -T svg > dependency-graph.svg
```

### for madge (TODO: right now, we have the problem, that it doesn't detect references to vue files...)

```
madge  --image graph.svg ./src
#or
madge --circular --image graph.svg ./src
#or
...
```

## Testing

We use cypress. All tests are located in folder ./test. To run the tests
you simply run:

```
cypress run --e2e
```

You can find videos of the tests in th folder `test/cypress/videos/`.
If you want to debug tests and see them live in action, run

```
cypress open --e2e
```

And select the tests you woud like to run.

## Code formatting

Quasar provides a built-int code formatter. New commits can only be merged once they have been formatted with it.

In visual studio code you can do it like this:

- press `ctrl - shift - p`
- search for "Format Document". If a formatter hasn#t been configured yet, choose "prettier"

alternativly like this:

```bash
yarn format
# or
npm run format
```
