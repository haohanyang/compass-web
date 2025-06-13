FROM node:22.16.0-slim

ARG COMPASS_WEB_VERSION=latest

RUN npm i -g compass-web@${COMPASS_WEB_VERSION}

USER node

CMD [ "compass-web" ]