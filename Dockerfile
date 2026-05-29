FROM node:18-alpine

WORKDIR /app

# Copy server package files and install dependencies
COPY server/package*.json ./
RUN npm install

# Copy the server source code
COPY server/ ./

# Expose the signaling port (Hugging Face / Render / Back4App will automatically route to this)
EXPOSE 3001

# Start the server
CMD ["node", "index.js"]
