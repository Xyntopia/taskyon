# coxacon (coxacon)

Component extractor and configurator frontend

## Install the dependencies

### install latest LTS of node

```bash
sudo snap install node --channel=14/stable --classic
```

### install yarn & node

- https://classic.yarnpkg.com/en/docs/install

```bash
curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | sudo apt-key add -
echo "deb https://dl.yarnpkg.com/debian/ stable main" | sudo tee /etc/apt/sources.list.d/yarn.list
```

```bash
yarn
```

install quasar-cli

```bash
yarn global add @quasar/cli
```

### Start the app in development mode (hot-code reloading, error reporting, etc.)
```bash
quasar dev
```

### Lint the files
```bash
yarn run lint
```

### Build the app for production
```bash
quasar build
```

### Customize the configuration
See [Configuring quasar.conf.js](https://quasar.dev/quasar-cli/quasar-conf-js).


## access icongenie

    yarn icongenie generate -m pwa -i /home/tom/Dropbox/company/brand/icon.png
