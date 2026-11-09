# Platform preview fixture sources

These fixtures retain only the fields used by the importers. Hosts, program
names, identifiers and policy wording use test values. Edge cases are synthetic.

- [HackerOne](https://api.hackerone.com/hacker-resources/) uses the published API examples and an anonymized public page visibility marker.
- [Bugcrowd](https://docs.bugcrowd.com/hacker-api/latest/) uses the published OpenAPI contract and an anonymized marker from the anonymous engagement page. The authenticated payload is a contract fixture.
- [Intigriti](https://api.intigriti.com/external/researcher/swagger/index.html) uses the published researcher API contract and an anonymized projection of the anonymous public page response. The authenticated payload is a contract fixture.
- [YesWeHack](https://api.yeswehack.com/programs/yes-we-hack) uses an anonymized projection of a live public API response.

CI uses only these local files and mock transports. The authenticated examples
do not contain account data or credentials.
