# Use an official Node.js image
FROM node:18

# Install FFmpeg
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

RUN npm install express axios cors fluent-ffmpeg

# Copy the rest of the application
COPY . .

RUN chmod -R 777 /app

# Expose port 3000
EXPOSE 7860

# Start the server
CMD ["node", "server.js"]
