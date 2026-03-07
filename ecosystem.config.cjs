const path = require("path");

const NODE24 = path.join(
  require("os").homedir(),
  ".nvm/versions/node/v24.14.0/bin/node",
);

module.exports = {
  apps: [
    {
      name: "xbecode-prod",
      script: path.join(__dirname, "apps/server/dist/index.mjs"),
      interpreter: NODE24,
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        XBECODE_PORT: "3775",
        XBECODE_STATE_DIR: path.join(require("os").homedir(), ".xbe", "prod"),
        XBECODE_NO_BROWSER: "1",
      },
    },
  ],
};
