# Project delivery standard

## Web defaults

- Prefer React, TypeScript, Vite, and Tailwind CSS for new web interfaces.
- Use one responsive component tree for Desktop and H5; cover 375, 390, 430,
  and 1440 px.
- Keep interactive targets at least 44 px and prevent root horizontal overflow.
- Use typed content and reusable components instead of duplicated full pages.
- Stitch and other generated HTML are design references, not production source.

## Quality gates

- Run formatting/static checks, tests, type checking, and a production build.
- Keep frontend and backend build scopes independently executable.
- Verify accessibility, responsive layouts, outbound links, and public content.
- A failed gate blocks deployment; never broaden one successful stage into a
  claim that the whole project is complete.

## Release safety

- Pull requests may build previews but must not publish production.
- Production deployment and public visibility changes require explicit owner
  authorization.
- Never commit credentials, private paths, raw private datasets, model weights,
  personal information, or unapproved source material.

