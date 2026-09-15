# Running the render site in Docker

The render site is a statically generated Next.js app. The Docker image builds
it and serves it with the Next.js standalone server. The published reports
(`data/*.json`) are baked in at build time, so **rebuild the image to pick up new
reports**. The site needs no secrets.

## Quick start

```bash
docker compose up --build
```

Then open http://localhost:3000 (report pages at `/research/<ticker>`, e.g.
http://localhost:3000/research/avgo).

## Without compose

```bash
docker build -t juniresearch-web .
docker run --rm -p 3000:3000 juniresearch-web
```

## What is and isn't in the image

- **In:** the built site and the reports that existed at build time. The image
  runs as a non-root user and serves on port 3000 (override with `-e PORT=...`).
- **Out:** the capture and synthesis pipeline. Its capture steps (`detect`,
  `facts:prepare`, the MCP tearsheet and search calls) reach Claude's connectors,
  which are not available inside a container, so run those in your dev session as
  before. After they produce a new `data/<ticker>.json`, rebuild the image.
