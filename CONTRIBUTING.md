# Code Contributions

## Before starting to code
 Please follow these guidelines before starting to code you feature or bugfix.
 * If you want to implement a bugfix or feature request from an existing issue, please comment on that issue that you will work on it. This helps us to coordinate what needs to be done and what not.
 * If you want to implement a feature request without an existing issue, please create an issue, so we know what you are working on and discuss the feature.
 * For major feature implementations make sure you are able to maintain your code in the future in regard to bugs and possible code conflicts in future updates. Optionally you could join the [Matrix](https://matrix.to/#/#freetubeapp:matrix.org) channel, so you will hear instantly if something needs to be worked on. 
 * Do not open pull requests that are primarily written by AI. It's a waste of our team's time. Repeat offenders will be banned.

## Before your Pull Request
Please follow these guidelines before sending your pull request and making contributions.
* When you submit a pull request, you agree that your code is published under the [GNU Affero General Public License](https://www.gnu.org/licenses/agpl-3.0.html)
* Please link the issue you are referring to.
* Do not include non-free software or modules with your code.
* Make sure your pull request is set up to merge your branch to FreeTube's development branch.
* Make sure your branch is up to date with the development branch before submitting your pull request.
* Stick to a similar style of code already in the project.  Please look at current code to get an idea on how to do this.
* Follow [ES6](https://rse.github.io/es6-features/) standards in your code. Ex: Use `let` and `const` instead of `var`. Do not use `function(response){//code}` for callbacks, use `(response) => {//code}`.
* Comment your code when necessary.  Follow the [JavaScript Documentation and Comments Standard](https://www.drupal.org/docs/develop/standards/javascript/javascript-api-documentation-and-comment-standards) for functions.
* Please follow proper Vue structure when creating new code / components.  Use existing code as well as the [Vue.js Guide](https://vuejs.org/guide/introduction.html) for reference.
* Please test your code.  Make sure new features work as well as existing core features such as watching videos or loading subscriptions.  New features need to work with both the Local API as well as the Invidious API
* Please make sure your code does not violate any standards set by our linter.  It's up to you to make fixes whenever necessary.  You can run `pnpm run lint` to check locally and `pnpm run lint-fix` to automatically fix smaller issues.
* Please limit the amount of Node Modules that you introduce into the project.  Only include them when **absolutely necessary** for your code to work (Ex: Using nedb for databases) or if a module provides similar functionality to what you are trying to achieve (Ex: Using autolinker to create links to outside URLs instead of writing the functionality myself).
* Please try to stay involved with the community and maintain your code.  We are only a handful of developers working on FreeTube in our spare time.  We do not have time to work on everything, and it would be nice if you can maintain your code when necessary.

# Setting up Your Environment

Check out the [wiki](https://docs.freetubeapp.io/development/getting-started/) page to learn how to set up your environment and get started.

# End-to-end tests

The e2e suite drives the real Electron app through the same clicks and typing a user would use. It only exercises the local API; the Invidious backend is not used or configured by these tests. All YouTube traffic is intercepted with Playwright routes, so the suite is fully offline in CI.

```bash
pnpm run test:e2e          # run the suite headlessly (builds dist/ when missing)
pnpm run test:e2e:live     # real playback of https://youtu.be/rz1B4B2yBZY (local only)
pnpm run test:e2e:ui       # Playwright UI mode
pnpm run test:e2e:debug    # step through a test
pnpm run test:e2e:record   # record fresh API fixtures from live YouTube (local only)
```

On Linux, Electron needs a display even in automation: run the suite with `xvfb-run -a pnpm run test:e2e`. CI does this in `.github/workflows/e2e.yml`.

`test/e2e/specs/live-playback.spec.js` launches an unmocked app, pastes the shared YouTube URL into the search bar, presses play, asserts that playback advances for at least 5 seconds, then opens Shaka's Resolution menu and switches to the next higher available quality. It needs real network access and is **skipped whenever `CI`, `GITHUB_ACTIONS` or `GITHUB_WORKFLOW` is set**, so it never runs in GitHub Actions. Because live streams can reload or throttle, this spec has its own retries.

## How it works

- `test/e2e/fixtures.js` launches the packaged app (`dist/main.js`) with an isolated temporary `--user-data-dir`, pre-seeded with settings that force the local API and disable update checks and optional integrations.
- `test/e2e/helpers/mock-youtube.js` intercepts YouTube API calls, watch HTML, player JS, thumbnails and media. Requests to any other host are aborted. The bot-guard poToken IPC call is stubbed in the main process because it runs outside the renderer's network context.
- `test/e2e/helpers/responses.js` builds small, deterministic InnerTube responses from the entities in `test/e2e/fixtures/entities.js`.
- `test/e2e/pages/` contains page objects; `test/e2e/specs/` contains the user journeys. Prefer visible UI and URL assertions over internal state, and use web-first expectations instead of fixed sleeps.

## Fixtures

Generated fixtures are enough for the core journeys. To refresh them against live YouTube, run `pnpm run test:e2e:record` locally; sanitized responses are written to `test/e2e/fixtures/recorded/`. Set `E2E_USE_RECORDED=1` to replay those saved responses instead of the generated ones. Never commit tokens, cookies or visitor data - the recorder strips them.

## Adding a test

1. Add fake data to `test/e2e/fixtures/entities.js` and, if needed, a response builder in `test/e2e/helpers/responses.js`.
2. Add the route to `mock-youtube.js` if a new endpoint is involved.
3. Write a journey in `test/e2e/specs/*.spec.js` using the `window` fixture and `data-testid` / role / text locators.
4. Run the new spec locally, then make sure the e2e workflow passes.
