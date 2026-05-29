FROM node:18-alpine

WORKDIR /app

# Copy server package files and install dependencies
COPY server/package*.json ./
RUN npm install

# Copy the server source code
COPY server/ ./

# Expose the signaling port (Hugging Face expects 7860 by default)
EXPOSE 7860
ENV PORT=7860

# Start the server
CMD ["node", "index.js"]
