FROM node:18-alpine

WORKDIR /app

# Copy package.json (regex handles Package.json or package.json casing)
COPY [Pp]ackage.json ./package.json

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Expose the port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]