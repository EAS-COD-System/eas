module.exports = {
  apps: [{
    name: "eas-backend",
    script: "server.js",
    env: {
      NODE_ENV: "production",
      PORT: 4000
    }
  }]
};
