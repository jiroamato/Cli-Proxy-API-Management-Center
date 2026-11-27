import { plugin } from 'bun';

// Vite turns `*.module.scss` imports into class-name maps, but Bun hands back the file path
// string, so `styles.search` resolved to `String.prototype.search` and React rejected the
// function as a className. Load CSS modules as an empty, prototype-less map instead: every
// class stays undefined in rendered markup, as the static-markup suites already expect.
plugin({
  name: 'css-modules',
  setup(build) {
    build.onLoad({ filter: /\.module\.s?css$/ }, () => ({
      loader: 'object',
      exports: { default: Object.create(null) },
    }));
  },
});
