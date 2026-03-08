const path = require("path");
const os = require("os");

module.exports = {
  apps: [
    {
      name: "xbecode-prod",
      script: path.join(__dirname, "scripts/pm2-prod.sh"),
      interpreter: "/bin/bash",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        XBECODE_PORT: "3775",
        XBECODE_STATE_DIR: path.join(os.homedir(), ".xbe", "prod"),
        XBECODE_NO_BROWSER: "1",
      },
    },
    {
      name: "xbecode-dev",
      script: path.join(__dirname, "scripts/pm2-dev.sh"),
      interpreter: "/bin/bash",
      cwd: __dirname,
      autorestart: false,
      env: {
        // Forward provider API keys from the launching shell to the dev server.
        // PM2 caches env at start time — run `pm2 delete xbecode-dev && pm2 start`
        // to pick up changes.
        ...(process.env.GEMINI_API_KEY ? { GEMINI_API_KEY: process.env.GEMINI_API_KEY } : {}),
        ...(process.env.GOOGLE_API_KEY ? { GOOGLE_API_KEY: process.env.GOOGLE_API_KEY } : {}),
        ...(process.env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY } : {}),
      },
    },
  ],
};
