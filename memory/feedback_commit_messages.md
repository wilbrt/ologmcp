---
name: No heredoc/cat in commit messages
description: User prefers commit messages without heredoc or cat syntax
type: feedback
---

Commit messages must be a single short line. No heredocs, no multi-line bodies, no bullet lists.

**Why:** User preference — keep it concise and clean.

**How to apply:** Always `git commit -m "short summary here"`. One line, no newlines.
