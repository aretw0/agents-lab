---
name: commit
description: "Read this skill before making git commits"
---

Create a git commit for the current changes using a concise Conventional Commits-style subject.

## Format

`<type>(<scope>): <summary>`

- `type` REQUIRED. Use `feat` for new features, `fix` for bug fixes. Other types: `docs`, `refactor`, `chore`, `test`, `perf`, `style`, `ci`.
- `scope` OPTIONAL. Short noun in parentheses for the affected area (e.g., `api`, `auth`, `ui`, `cli`).
- `summary` REQUIRED. Short, imperative, lowercase, ≤ 72 chars, no trailing period.

## Rules

- Body is OPTIONAL. If needed, add a blank line after the subject and write short paragraphs.
- Do NOT include breaking-change markers or footers.
- Do NOT add sign-offs (`Signed-off-by`).
- Only commit — do NOT push.
- Always pass the message on the command line, never rely on an interactive editor:
  ```bash
  git commit -m "fix(auth): handle expired token on refresh"
  ```
- If it is unclear which files to include, ask before staging.
- Treat caller-provided arguments as additional commit guidance:
  - Freeform text → influences scope, summary, and body
  - File paths/globs → limit which files to stage and commit
  - Combined → honor both

## Steps

1. Check if the user provided specific file paths/globs and/or instructions.
2. Run `git status` and `git diff` to understand current changes.
3. (Optional) Run `git log -n 20 --pretty=format:%s` to see commonly used scopes in this project.
4. Ask for clarification if there are ambiguous extra files.
5. Stage only the intended files.
6. Run `git commit -m "<subject>"` (add `-m "<body>"` if a body is needed).
