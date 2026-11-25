FROM node:22-alpine
WORKDIR /app
COPY . .
RUN mkdir -p /app/data && chown node:node /app/data
ENV PORT=8080 DATA_DIR=/app/data
VOLUME /app/data
EXPOSE 8080
USER node
CMD ["node", "server.js"]
