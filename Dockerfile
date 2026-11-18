# Production image: builds the React app and the API, serves both from one Node process.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm install --omit=dev --no-audit --no-fund -w server
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/migrations server/migrations
COPY --from=build /app/client/dist client/dist
WORKDIR /app/server
RUN mkdir -p storage/public storage/private && chown -R node:node storage
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
