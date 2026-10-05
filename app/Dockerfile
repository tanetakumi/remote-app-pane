FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html ./
COPY src ./src
COPY scripts ./scripts
COPY public ./public
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV HOST=0.0.0.0 PORT=8443
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY src/server ./src/server
RUN mkdir /app/data && chown node:node /app/data
USER node
EXPOSE 8443
CMD ["node", "src/server/index.mjs"]
