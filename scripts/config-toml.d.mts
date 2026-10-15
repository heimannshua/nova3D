// Types of scripts/config-toml.mjs, for the tests that import it. The module is plain ESM so that a script and CI can run it without a build.
export type TomlProblem = {line: number; kind: string; description: string};
export type TomlSections = {sections: Map<string, Map<string, string>>; problems: TomlProblem[]};
export const otherProviders: string[];
export const web3Methods: string[];
export function readSections(text: string): TomlSections;
export function rawValue(parsed: TomlSections, section: string, key: string): string | undefined;
export function booleanValue(parsed: TomlSections, section: string, key: string): boolean | undefined;
export function stringList(parsed: TomlSections, section: string, key: string): string[] | undefined;
export function stringValue(parsed: TomlSections, section: string, key: string): string | undefined;
export function authDeclarationProblems(text: string): string[];
