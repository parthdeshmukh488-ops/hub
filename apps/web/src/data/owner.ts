import storyline from "@leash/contracts/fixtures/demo-storyline.json";

/**
 * Whose agents the app shows. Until wallet connection (build step 2) this is the demo storyline's
 * owner, which is also who the indexer's fixture replay serves.
 */
export const DEMO_OWNER: string = storyline.keys.owner;
