#!/bin/bash
# Minimal MCP server exposing only olog_ws_assert — used by the implement agent.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${1:-$(pwd)}"
export OLOG_ROOT="$PROJECT_ROOT"
exec node "$SCRIPT_DIR/packages/mcp-server/dist/index-ws-assert.js"
