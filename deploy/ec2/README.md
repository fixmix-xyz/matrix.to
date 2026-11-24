# Dev lane landing page on the Zymi EC2 dev host

The dev lane's share-link landing page (`https://to-dev.zymi.app`, SPEC-deeplink.md §6.5) runs on the same EC2
host and load balancer as the Zymi dev stack (`dev.zymi.app`, `matrix-dev.zymi.app`). The host, its access and
its load balancer are described in zymi-ai-server's `deploy/ec2/README.md`; this file covers only what this
repository adds.

```text
ALB zymi-dev (to-dev.zymi.app, HTTPS, *.zymi.app cert) ──► host :8110 ──► zymi-links-dev landing ──► landing/edge.js
```

The container runs `scripts/serve.js`, the same server as `npm start`, so the status codes come from the link
parser (`linkParse`) exactly as in `npm run check`. It never makes a request of its own, has no secrets, and
writes nothing (read-only root filesystem, no capabilities). It is its own Compose project, `zymi-links-dev`, so
no command here can touch the `zymi-dev` stack.

## AWS resources

Account 848776073113 (profile `zymix-production`), region `eu-west-2`, tagged `Project=zymi`, `Environment=dev`,
`ManagedBy=manual` (and `map-migrated=migQJ7XN3O8EO` on the target group), like the rest of the dev host. Created
2026-11-18 by the first release; the IDs are in its `aws-resources.json`, in
`/srv/zymi/deployments/links-dev-20261118-dbbb140/` on the host. Later releases reuse them and add none.

| Resource | Name | Notes |
| --- | --- | --- |
| Target group | `zymi-dev-links` | HTTP 8110 in `vpc-097e939448988be69`, instance `i-0a81390f6c2eb996a` (`zymi-dev-host`). Health check `/` (200) every 15 s, deregistration delay 30 s. |
| Host security group rule | `zymi-dev-host` (`sg-0ac52ba0f5944c49e`) | Inbound TCP 8110 from `zymi-dev-alb`. |
| ALB security group rule | `zymi-dev-alb` (`sg-07b67f2bf8f4b9ead`) | Outbound TCP 8110 to `zymi-dev-host`. The ALB's egress is per port, so without this the target stays unhealthy. |
| Listener rule | HTTPS 443 on `zymi-dev`, priority 35 | Host `to-dev.zymi.app` → forward to `zymi-dev-links`. Every path: the page answers 404 itself for links the parser rejects. |
| Route 53 record | `to-dev.zymi.app` in zone `zymi.app` (`Z05985182ISHAGUSW8V0K`) | Alias A to the `zymi-dev` ALB. The `*.zymi.app` certificate covers it. |

The load balancer forwards the request path unchanged, so `%2F` reaches the function encoded, as §6.5 requires
of the host (checked below).

## Host layout

| Path | What |
| --- | --- |
| `/srv/zymi/links-dev/compose.env` | From `links-dev.compose.env.example`; `LINKS_IMAGE` names the running image. |
| `/srv/zymi/deployments/links-dev-<yyyymmdd>-<short sha>/` | `source.tar.gz` (the archive as sent) and `source/` (unpacked: the image's sources at the deployed commit), `release.json` (the commit and image deployed), `rollback.txt` (the previous `LINKS_IMAGE`). The first release's directory also has `aws-resources.json`. |

The host has no GitHub key. The source goes over as a `git archive` of only what the image needs (`package.json`,
`config`, `landing`, `scripts/build.js`, `scripts/serve.js`, `Dockerfile`, `.dockerignore`, `deploy`): about 25 KB
gzipped, 33 KB as base64, small enough to travel inline in the SSM command. The whole repository is 1 MB and is not.

## Deploy

Over SSM (`aws ssm send-command --document-name AWS-RunShellScript`, the script as one `commands` string), with
`SHA` the commit being deployed:

```sh
D=/srv/zymi/deployments/links-dev-$(date -u +%Y%m%d)-${SHA:0:7}
mkdir -p "$D/source" && base64 -d <<'B64' | tar -xz -C "$D/source"
<git archive --format=tar.gz $SHA package.json config landing scripts/build.js scripts/serve.js Dockerfile .dockerignore deploy | base64>
B64
cd "$D/source"
docker build --build-arg LANE=dev --build-arg VCS_REF=$SHA -t zymi-links:dev-${SHA:0:7} .
# first deploy only: install -d /srv/zymi/links-dev && cp deploy/ec2/links-dev.compose.env.example /srv/zymi/links-dev/compose.env
sed -i "s|^LINKS_IMAGE=.*|LINKS_IMAGE=zymi-links:dev-${SHA:0:7}|" /srv/zymi/links-dev/compose.env
docker compose --env-file /srv/zymi/links-dev/compose.env -f deploy/ec2/compose.yaml up -d --wait
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8110/
```

Before the `sed`, write the previous `LINKS_IMAGE` to `rollback.txt`. To roll back, put it back in `compose.env`
and run the same `up -d --wait`.

## Releases

Each release is in `/srv/zymi/deployments/links-dev-<date>-<commit>/` on the host. Add a row for each deploy; the
running one is whatever `LINKS_IMAGE` in `compose.env` names.

| Date (UTC) | Commit | Image | What changed | Rolls back to |
| --- | --- | --- | --- | --- |
| 2026-11-24 13:44 | `383739b` ([#3](https://github.com/fixmix-xyz/matrix.to/pull/3)) | `zymi-links:dev-383739b` | SPEC-deeplink round 8: links to another server's rooms and users are valid (no server-name check), so `/r/develop:topsecret.network` is now 200, and room links carry up to 3 `via` servers, which the page keeps in its handoff. The AASA is unchanged. | `zymi-links:dev-1ad40f7` |
| 2026-11-19 11:41 | `1ad40f7` ([#2](https://github.com/fixmix-xyz/matrix.to/pull/2)) | `zymi-links:dev-1ad40f7` | The AASA's `appIDs` is `858257F65U.london.zymi.app`, the zymi-ios dev and TestFlight build, instead of the placeholder `VZZQ2Q6734.ai.pagepeek.app.zymi.dev`. Nothing else changed. Checked on a device the same day: a `to-dev.zymi.app` link opens the dev build (with `applinks:to-dev.zymi.app`); the page's "Open Zymi" button was not checked separately. | `zymi-links:dev-dbbb140` |
| 2026-11-18 | `dbbb140` ([#1](https://github.com/fixmix-xyz/matrix.to/pull/1)) | `zymi-links:dev-dbbb140` | First deploy. Created the AWS resources above. | Nothing (first deploy): `docker compose ... down` |

## Check

From anywhere:

- `curl -sI https://to-dev.zymi.app/` → 200, `text/html`, with the page's CSP and HSTS headers.
- `curl -sI https://to-dev.zymi.app/task/a%2Fb` → 404 with the CSP header. The ALB's own 404 has no CSP, so the
  header proves the listener rule sends the name to the page.
- `curl -sI 'https://to-dev.zymi.app/r/a%2Fb:dev.zymi.app'` → **200**, while `/r/a/b:dev.zymi.app` → 404. Only an
  undecoded `%2F` makes that room alias valid, so this pair proves the path arrived as sent.
- `curl -sI 'https://to-dev.zymi.app/r/develop:topsecret.network'` → **200** (SPEC-deeplink round 8: another
  server's room is a link too; before round 8 it was 404 and the page said the link isn't valid).
- `curl -s https://to-dev.zymi.app/.well-known/apple-app-site-association` → 200, `application/json`, no redirect,
  `appIDs` from `config/lanes/dev.json`.
- `curl -s https://app-site-association.cdn-apple.com/a/v1/to-dev.zymi.app` → the same `appIDs`. iOS fetches the
  file from Apple's CDN, not from the host, so after an `app_ids` change this is what devices see. It can lag the
  host.
- `aws elbv2 describe-target-health` on `zymi-dev-links` → `healthy`; `https://dev.zymi.app/ready` and
  `https://matrix-dev.zymi.app/_matrix/client/versions` still answer 200.

## Remove

`docker compose ... down` on the host, then delete in reverse: the Route 53 record, listener rule 35, the two
security group rules, the target group.
