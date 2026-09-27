/* docs.test.ts: The troubleshooting guide covers every error code the plugin can log. */
import { ErrorCode } from "./protocol/errors.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("docs/Troubleshooting.md has a section for every error code", () => {

  const guide = readFileSync(new URL("../docs/Troubleshooting.md", import.meta.url), "utf8");

  for(const code of Object.values(ErrorCode)) {

    assert.match(guide, new RegExp("^## " + code + "$", "m"), code);
  }
});
