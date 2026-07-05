# Glama.ai inspection image for @dashclaw/mcp-server (also usable standalone).
# The server starts and answers initialize/tools/list with NO env vars —
# governance tools register only when DASHCLAW_URL + DASHCLAW_API_KEY are set.
# This is the Dockerfile to paste into Glama's "Add Server" flow (Glama builds
# from its own UI-provided Dockerfile, not from the repo).
FROM node:20-alpine

RUN npm install -g @dashclaw/mcp-server

ENTRYPOINT ["dashclaw-mcp"]
