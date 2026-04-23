#!/bin/bash
# Wrapper script for olog MCP server
# Usage: ./run-olog-mcp.sh [project-root]

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Use provided project root or default to current directory
PROJECT_ROOT="${1:-$(pwd)}"

export OLOG_ROOT="$PROJECT_ROOT"

# Run the MCP server from its directory
exec node "$SCRIPT_DIR/packages/mcp-server/dist/index.js"
