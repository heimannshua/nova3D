// Types of scripts/staging-config.mjs, for the tests that import it.
export function stagingSiteOrigin(value: string): string;
export function stagingConfigText(configText: string, origin: string): string;
export function writeStagingConfig(options: {workdir: string; siteUrl: string; configPath?: string}): {path: string; origin: string};
