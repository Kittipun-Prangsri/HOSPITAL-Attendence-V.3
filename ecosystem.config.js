module.exports = {
  apps: [{
    name: "attendance-system",
    script: "./src/index.js", // Direct node script entry point for PM2 to manage properly
    instances: 1,              // Run 1 instance to maintain a stable DB connection
    autorestart: true,         // Automatically restart on crash
    watch: false,              // Turn off watch to save resources
    max_memory_restart: "300M", // Restart if memory exceeds 300MB to prevent leaks
    env: {
      NODE_ENV: "production",
    },
    error_file: "./logs/err.log", // Error logs destination
    out_file: "./logs/out.log"    // Regular logs destination
  }]
};
