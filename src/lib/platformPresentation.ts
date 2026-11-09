/** Labels only; stored platform identities stay unchanged. */
export function platformLabel(value: string | null | undefined): string {
  if (!value) return 'Private program';
  return ({YESWEHACK:'YesWeHack',HACKERONE:'HackerOne',INTIGRITI:'Intigriti',BUGCROWD:'Bugcrowd',OTHER:'Other',PRIVATE:'Private',IMMUNEFI:'Immunefi',GENERIC:'Generic'} as Record<string,string>)[value] ?? value;
}
