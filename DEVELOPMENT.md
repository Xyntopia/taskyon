# xyntopia-gui

## build configuration

TODO: find a concept ;).

## code sync between projects

We can synchronize and exchange  code pieces between different project using git diff

for example the to get a diff between

or to merge manually:

  git merge --no-commit origin/something

in the case of a conflict use our branch:

  git merge -Xours --no-commit origin/quasar1merge


## size comparisons

bare-bones quasar is aout 179.37 KB in:

Build mode........ spa
 Pkg quasar........ v2.5.5
 Pkg @quasar/app... v3.3.3
 Pkg webpack....... v5
 Debugging......... no
 Publishing........ no
 Transpiled JS..... yes (Babel)

then:

- amplify + axios + payments ~ 500-700kb vendor size
- danfojs: 10MB!!!
- vuex: 100kb  (maye get rid of it?)
- i18n: have to keep it anyways...
- qmarkdown adds an additional 250kb

if we want to find out *where* large packages are coming from:

- first make sure in quasar.conf.js we set "analyze: true"
- in the resulting output get the parge packages
- with yarn why <package-name> check which 3rd party library is responsible

## static site generation

https://github.com/freddy38510/quasar-app-extension-ssg

quasar ext add ssg

## serverless development setup

    curl -o- -L https://slss.io/install | bash


## aws amplify for authentication

    npm install -g @aws-amplify/cli

## generate new icons:

install icongenie from here: https://quasar.dev/icongenie/installation


and then do this for example:

  icongenie g -m all -i (..)/brand/doxcavator.png

oher icons can be placed in "assets" folder

install "tauricon":

  yarn add github:tauri-apps/tauricon

and for tauri:

  yarn run tauricon -l -t src-tauri/icons (..)/brand/doxcavator.png

we need to replace the *.icns icon using this commandline program do this inside icons folder:

  png2icns icon.icns 32x32.png 128x128.png
