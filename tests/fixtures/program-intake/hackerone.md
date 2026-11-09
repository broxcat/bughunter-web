# Orion Security
Platform: HackerOne

## In scope
- https://api.orion.example.test — API
- app.orion.example.test — web application

## Out of scope
- https://api.orion.example.test/admin/*

## Rules of engagement
Use the following identification on requests: X-Bug-Bounty: HackerOne-<username>
Required User-Agent: OrionResearch/1.0
Keep automated requests below 5 requests per second.
Use at most 2 concurrent requests.
Brute force is prohibited.

## Non-qualifying vulnerabilities
- Open redirect
- Self-XSS without an impact on another user
