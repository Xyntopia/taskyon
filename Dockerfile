FROM node:latest
# set working directory
ENV APPDIR="/app"
RUN mkdir $APPDIR
WORKDIR $APPDIR
COPY . $APPDIR

RUN yarn install
RUN yarn run quasar build -m spa

# start app
#CMD ["quasar", "start"]
