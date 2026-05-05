#!/bin/bash
# Wrapper script for olog mining MCP server (heavy analysis tools only)
# Usage: ./run-olog-mining-mcp.sh [project-root]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${1:-$(pwd)}"

export OLOG_ROOT="$PROJECT_ROOT"

exec node "$SCRIPT_DIR/packages/mcp-server/dist/index-mining.js"
