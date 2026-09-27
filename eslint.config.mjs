// Lint configuration: the homebridge-plugin-utils preset (the same one homebridge-unifi-protect uses), with the usual relaxations for test files.
import hbPluginUtils from "homebridge-plugin-utils/eslint";

export default hbPluginUtils({

  allowDefaultProject: [ "eslint.config.mjs", "homebridge-ui/*.js", "homebridge-ui/public/*.mjs" ],
  extraConfigs: [
    { files: ["homebridge-ui/server.js"], languageOptions: { globals: { console: "readonly" } } },
    {

      files: [ "**/*.test.ts", "**/*.helpers.ts" ],
      rules: {

        "@typescript-eslint/explicit-function-return-type": "off",
        "@typescript-eslint/no-floating-promises": "off",
        "@typescript-eslint/no-non-null-assertion": "off",
        "@typescript-eslint/no-unnecessary-condition": "off",
        "@typescript-eslint/require-await": "off"
      }
    }
  ],
  js: [ "homebridge-ui/public/*.mjs", "homebridge-ui/server.js", "eslint.config.mjs" ],
  ts: ["src/**/*.ts"],
  ui: ["homebridge-ui/public/ui.mjs"]
});
