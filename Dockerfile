FROM node:18-alpine

WORKDIR /app

# Copy package files (regex handles Package.json or package.json casing)
COPY [Pp]ackage.json package-lock.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Create data directory and set permissions to prevent runtime permission errors
RUN mkdir -p AlphaFlow-backend/data && chmod 777 AlphaFlow-backend/data

# Expose the port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]