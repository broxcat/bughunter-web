// Minimal typing for the transitive js-yaml parser used by deployment tests.
declare module 'js-yaml' {
  export function load(text: string): unknown;
}
