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
    },
  ],
};
