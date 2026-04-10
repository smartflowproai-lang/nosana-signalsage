/**
 * SignalSage — ElizaOS v2 project entry point.
 *
 * Exports a Project definition so `@elizaos/cli` can boot SignalSage with
 * its custom character file AND the bundled x402-smartflow plugin in one
 * shot. This is the wire between the character JSON (persona, system
 * prompt, examples) and the TypeScript plugin (actions, providers,
 * evaluators).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Character, Project, ProjectAgent } from "@elizaos/core";

import { x402SmartFlowPlugin } from "./plugins/x402-smartflow";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// The character file is the single source of truth for persona + style.
// We resolve it relative to this module so the same code works in dev
// (tsx) and inside the Docker image (bundled src/).
const characterPath = join(__dirname, "..", "characters", "signalsage.character.json");
const signalSageCharacter = JSON.parse(
  readFileSync(characterPath, "utf-8")
) as Character;

const signalSageAgent: ProjectAgent = {
  character: signalSageCharacter,
  plugins: [x402SmartFlowPlugin],
  init: async () => {
    // Nothing to bootstrap — the plugin is stateless and the x402 client
    // is lazily constructed from env. Keeping init present is how the CLI
    // recognises this as a valid ProjectAgent.
    return;
  },
};

const project: Project = {
  agents: [signalSageAgent],
};

export default project;
// NOTE: do NOT re-export the plugin object here. The ElizaOS CLI's
// loadProject() inspects every named export for `{ name, description }` and
// if it finds one it misclassifies the whole module as a plugin, ignoring
// the default project export. Keep named exports plugin-shaped-free.
