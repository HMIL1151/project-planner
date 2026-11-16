## Why

<!-- The problem this solves. Link the issue if there is one: Closes #123 -->

## What

<!-- What changed, in the order a reviewer should read it. -->

## Checks

<!-- All of these run in CI too. Tick what you ran locally. -->

- [ ] `npm run build` (type check + bundle)
- [ ] `npm test`
- [ ] `npm run lint` and `npm run lint:css`
- [ ] `npm run format`
- [ ] Tried it in a real vault

## Notes for the maintainer

- [ ] New user-facing strings are in `en`, `nl` and `zh-CN`
- [ ] New logic in `src/lib/` has a matching `test/*.test.ts`
- [ ] No new settings key, or: the new key defaults to the old behaviour
- [ ] `main.js` and `styles.css` are untouched

<!-- Anything you are unsure about, or decided one way and could have decided
     another, is worth saying here. It is the fastest part of a review. -->
