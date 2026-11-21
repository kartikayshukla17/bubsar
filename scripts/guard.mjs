// Definition-of-done checks 1 and 2, run by `npm run lint`.
//  1. No LLM anywhere in the MVP: src/ imports no model SDK. That makes "the LLM never
//     sees credentials" true by construction.
//  2. busbar never reads browser credential stores: src/ never names one.
// Fails loudly with file:line for each hit.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.argv[2] ?? "src";

const MODEL_SDK =
  /\b(?:from|import|require)\s*\(?\s*["'](?:@anthropic-ai\/[^"']*|anthropic|openai|@openai\/[^"']*|ai|@ai-sdk\/[^"']*|langchain[^"']*|@langchain\/[^"']*|@google\/generative-ai|@google\/genai|cohere-ai|@mistralai\/[^"']*|ollama|llamaindex)["']/;
const CREDENTIAL_STORE =
  /\b(?:Cookies|Login Data|cookies\.sqlite|logins\.json|key4\.db|Safe Storage)\b/;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(?:[cm]?[jt]sx?)$/.test(name)) yield path;
  }
}

const hits = [];
for (const file of files(ROOT)) {
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      const at = `${relative(process.cwd(), file)}:${i + 1}`;
      if (MODEL_SDK.test(line)) hits.push(`${at}: imports a model SDK (DoD 1: no LLM in the MVP)`);
      if (CREDENTIAL_STORE.test(line)) hits.push(`${at}: names a browser credential store (DoD 2)`);
    });
}

if (hits.length) {
  console.error(hits.join("\n"));
  process.exit(1);
}
console.log(`guard: ${ROOT}/ has no model SDK and no credential-store access`);
