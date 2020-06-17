FROM node:12-alpine

RUN apk update && \
    apk --no-cache upgrade && \
    apk add --no-cache git \
                       alpine-sdk \
                       bash

# Install dependencies first, in a different location
# for easier app bind mounting for local development
WORKDIR /

COPY package.json package-lock.json ./
RUN npm ci --production

FROM node:12-alpine

LABEL maintainer="Dash Developers <dev@dash.org>"
LABEL description="Test suite for Dash Platform"

# Copy NPM modules
COPY package.json package-lock.json ./
COPY --from=0 /node_modules/ /node_modules

ENV PATH /node_modules/.bin:$PATH

# Copy project files
WORKDIR /usr/src/app
COPY . ./

ARG NODE_ENV=production
ENV NODE_ENV ${NODE_ENV}

ENTRYPOINT ["./bin/test.sh"]
