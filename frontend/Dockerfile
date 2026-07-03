# Build stage
FROM node:20-alpine AS build

WORKDIR /app

# Copy dependency files
COPY package*.json ./
RUN npm ci

# Copy codebase and compile Vite project
COPY . .
RUN npm run build

# Production serving stage via Nginx
FROM nginx:alpine

# Copy built production assets
COPY --from=build /app/dist /usr/share/nginx/html

# Replace default configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
