# Contributing

Thanks for helping. Bug reports with a debug log, reports from projector models not yet listed, and pull requests are all welcome.

## Development setup

Requires Node.js 22.20 or later.

```bash
npm install
npm test
```

The tests run against simulated ADCP and SDCP projectors (`src/protocol/fake-*.helpers.ts`), so no hardware is needed.

To try the plugin in a real Homebridge:

```bash
npm run fake-projector -- --password Projector   # terminal 1
npm run dev                                      # terminal 2
```

## Before opening a pull request

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm run check-docs
```

- Tests are colocated with the code (`*.test.ts`) and use `node:test`. New behaviour needs a test; bug fixes need a test that fails without the fix.
- Keep `src/protocol/` free of Homebridge imports. It must stay usable on its own.
- Nothing may be fire-and-forget: every promise is awaited or handled.
- New user-facing errors get an `SPJ-*` code, a hint in `src/protocol/errors.ts` and a section in `docs/Troubleshooting.md` (a test enforces this).
- Changing `src/options.ts`? Run `npm run build-docs` to regenerate `docs/FeatureOptions.md`.
- Design changes: add or update an ADR in `docs/adr/`.

## Reporting a bug

Use the [bug report form](https://github.com/shivanathd/homebridge-sony-projectors/issues/new/choose). Include your projector model, the plugin, Homebridge
and Node.js versions, and a log with **Debug logging** turned on in the plugin settings.
