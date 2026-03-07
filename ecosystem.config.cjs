const path = require("path");

const NODE24 = path.join(
  require("os").homedir(),
  ".nvm/versions/node/v24.14.0/bin/node",
);

module.exports = {
  apps: [
    {
      name: "t3code-prod",
      script: path.join(__dirname, "apps/server/dist/index.mjs"),
      interpreter: NODE24,
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        T3CODE_PORT: "3775",
        T3CODE_STATE_DIR: path.join(require("os").homedir(), ".t3", "prod"),
        T3CODE_NO_BROWSER: "1",
      },
    },
  ],
};
