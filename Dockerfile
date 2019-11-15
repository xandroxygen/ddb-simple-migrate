FROM instructure/node:10

ENV APP_HOME /usr/src/app/
USER root

COPY --chown=docker:docker . $APP_HOME
WORKDIR $APP_HOME
USER docker
RUN yarn install