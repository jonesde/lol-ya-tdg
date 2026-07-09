# AGENTS.md

Before doing any reqested task, if you have not already, always read `TECHNICAL.md` to understand the project, its structure, and how to work with it.

## Code Rules

**Code Variable Name Rule**: Always use descriptive variable names with full words. Instead of 'ts' use a descriptive full-word form like 'tileSize' or 'timestamp' (both could be 'ts'). NEVER use a one letter variable name, instead use at least one full word.

**Code Line Splitting Rule**: Target roughly 100 character lines. Use available line width for parameter lists, inline defined arrays/lists and objects/maps, and all other sequences of expressions within a single statement. Never put one short parameter/value per line. 

## Search and Replace Workflow

Every search and replace operation must follow this pattern:
1. **One file at a time**: process all replacements for a single file before moving to the next.
2. **Write the regular expression**: define the exact regex pattern to use in both a verify search and the replacement search.
3. **Verify matches**: use the regex to search the file and confirm:
   - Only the intended occurrences are matched
   - All intended occurrences are included
4. **Run the search and replace**: apply the replacement if, and only if, the verification passes.

If a variable name or other value to replace is not sufficiently distinct to isolate with a regular expression, then: limit the search and replace to line ranges within the file, or patch each replacement manually instead of doing a search and replace.
