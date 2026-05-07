import { strict as assert } from "node:assert";
import { test } from "node:test";
import { extractCookieHeader, parseCookieEntries } from "../dist/auth/token.js";

test("extractCookieHeader extracts plain cookie header", () => {
  const input = "cookie: name=value; other=thing";
  assert.strictEqual(extractCookieHeader(input), "name=value; other=thing");
});

test("extractCookieHeader extracts from curl format", () => {
  const input = `curl 'https://example.com' \\\n  -H 'cookie: foo=bar; baz=qux'`;
  assert.strictEqual(extractCookieHeader(input), "foo=bar; baz=qux");
});

test("parseCookieEntries parses cookie string to entries", () => {
  const entries = parseCookieEntries("a=1; b=2; c=3");
  assert.strictEqual(entries.length, 3);
  assert.strictEqual(entries[0].name, "a");
  assert.strictEqual(entries[0].value, "1");
});
