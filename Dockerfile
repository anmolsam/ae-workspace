# Single-service image: builds the React web app, then runs the Express API
# which serves both the JSON API and the built web app from one origin.
FROM node:22-alpine

WORKDIR /app

# Install all workspace deps (force dev deps so vite/tsc are available for the
# web build even if the platform sets NODE_ENV=production).
COPY . .
RUN npm install --workspaces --include-workspace-root --production=false

# Build the web bundle (reads apps/web/.env.production for public VITE_ vars).
RUN npm run build --workspace apps/web

# Runtime only from here.
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "apps/api/src/server.js"]
