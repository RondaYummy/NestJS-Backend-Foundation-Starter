FROM node:24 AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:24 AS runner
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
CMD ["npm", "run", "start:api"]
