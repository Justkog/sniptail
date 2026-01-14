#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const TEMPLATE_PATH = new URL("./slack-app-manifest.template.yaml", import.meta.url);
const DEFAULT_OUTPUT = "slack-app-manifest.yaml";

const stripQuotes = (value) => {
  if (!value) return value;
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const parseDotEnv = (content) => {
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const normalized = trimmed.startsWith("export ") ? trimmed.slice(7) : trimmed;
    const idx = normalized.indexOf("=");
    if (idx === -1) continue;
    const key = normalized.slice(0, idx).trim();
    const rawValue = normalized.slice(idx + 1).trim();
    env[key] = stripQuotes(rawValue);
  }
  return env;
};

const slugifyCommandPrefix = (name) => {
  if (!name) return name;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  return slug || name.toLowerCase();
};

const parseArgs = (argv) => {
  const args = { name: null, output: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--name" || arg === "-n") {
      args.name = argv[i + 1];
      i += 1;
    } else if (arg === "--output" || arg === "-o") {
      args.output = argv[i + 1];
      i += 1;
    } else if (!arg.startsWith("-")) {
      args.name = arg;
    }
  }
  return args;
};

const usage = () => {
  console.log("Usage: node scripts/generate-slack-manifest.mjs [bot-name] [--output path]");
  console.log("       node scripts/generate-slack-manifest.mjs --name \"My Bot\" --output slack-app-manifest.yaml");
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  let botName = args.name || process.env.BOT_NAME;

  if (!botName) {
    try {
      const envPath = path.join(process.cwd(), ".env");
      const envContent = await fs.readFile(envPath, "utf8");
      const env = parseDotEnv(envContent);
      botName = env.BOT_NAME;
    } catch (error) {
      // ignore missing .env
    }
  }

  if (!botName) {
    console.error("BOT_NAME not provided. Pass a name or set BOT_NAME in .env.");
    usage();
    process.exit(1);
  }

  const outputPath = args.output || DEFAULT_OUTPUT;
  const template = await fs.readFile(TEMPLATE_PATH, "utf8");
  const commandPrefix = slugifyCommandPrefix(botName);

  const manifest = template
    .replace(/Sniptail/g, botName)
    .replace(/sniptail/g, commandPrefix);

  await fs.writeFile(path.resolve(process.cwd(), outputPath), manifest, "utf8");

  console.log(`Generated ${outputPath} with bot name "${botName}" (commands use "${commandPrefix}").`);
};

main().catch((error) => {
  console.error("Failed to generate manifest:", error);
  process.exit(1);
});
