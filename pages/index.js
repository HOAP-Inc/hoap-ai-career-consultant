[17:05:51.250] Running build in Washington, D.C., USA (East) – iad1
[17:05:51.250] Build machine configuration: 4 cores, 8 GB
[17:05:51.273] Cloning github.com/hoap-takada/hoap-ai-career-consultant (Branch: main, Commit: 29354dd)
[17:05:51.281] Skipping build cache, deployment was triggered without cache.
[17:05:51.559] Cloning completed: 285.000ms
[17:05:51.857] Running "vercel build"
[17:05:52.270] Vercel CLI 46.0.2
[17:05:52.582] Warning: Detected "engines": { "node": ">=18.17.0" } in your `package.json` that will automatically upgrade when a new major Node.js Version is released. Learn More: http://vercel.link/node-version
[17:05:52.591] Installing dependencies...
[17:05:57.617] npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead
[17:06:01.627] 
[17:06:01.627] added 58 packages in 9s
[17:06:01.627] 
[17:06:01.627] 9 packages are looking for funding
[17:06:01.627]   run `npm fund` for details
[17:06:01.677] Detected Next.js version: 14.2.5
[17:06:01.680] Running "npm run build"
[17:06:02.076] 
[17:06:02.076] > hoap-ai-career-consultant@0.1.0 build
[17:06:02.076] > next build
[17:06:02.076] 
[17:06:02.652] Attention: Next.js now collects completely anonymous telemetry regarding usage.
[17:06:02.652] This information is used to shape Next.js' roadmap and prioritize features.
[17:06:02.652] You can learn more, including how to opt-out if you'd not like to participate in this anonymous program, by visiting the following URL:
[17:06:02.652] https://nextjs.org/telemetry
[17:06:02.652] 
[17:06:02.755]   ▲ Next.js 14.2.5
[17:06:02.756] 
[17:06:02.756]    Linting and checking validity of types ...
[17:06:02.874]    Creating an optimized production build ...
[17:06:07.838] Failed to compile.
[17:06:07.838] 
[17:06:07.839] ./styles/globals.css.webpack[javascript/auto]!=!./node_modules/next/dist/build/webpack/loaders/css-loader/src/index.js??ruleSet[1].rules[6].oneOf[14].use[1]!./node_modules/next/dist/build/webpack/loaders/postcss-loader/src/index.js??ruleSet[1].rules[6].oneOf[14].use[2]!./styles/globals.css
[17:06:07.839] Error: Cannot find module 'tailwindcss'
[17:06:07.839] Require stack:
[17:06:07.839] - /vercel/path0/node_modules/next/dist/build/webpack/config/blocks/css/plugins.js
[17:06:07.839] - /vercel/path0/node_modules/next/dist/build/webpack/config/blocks/css/index.js
[17:06:07.840] - /vercel/path0/node_modules/next/dist/build/webpack/config/index.js
[17:06:07.840] - /vercel/path0/node_modules/next/dist/build/webpack-config.js
[17:06:07.840] - /vercel/path0/node_modules/next/dist/build/webpack-build/impl.js
[17:06:07.840] - /vercel/path0/node_modules/next/dist/compiled/jest-worker/processChild.js
[17:06:07.840]     at Function.<anonymous> (node:internal/modules/cjs/loader:1365:15)
[17:06:07.840]     at /vercel/path0/node_modules/next/dist/server/require-hook.js:55:36
[17:06:07.840]     at Function.resolve (node:internal/modules/helpers:145:19)
[17:06:07.840]     at loadPlugin (/vercel/path0/node_modules/next/dist/build/webpack/config/blocks/css/plugins.js:49:32)
[17:06:07.841]     at /vercel/path0/node_modules/next/dist/build/webpack/config/blocks/css/plugins.js:157:56
[17:06:07.841]     at Array.map (<anonymous>)
[17:06:07.841]     at getPostCssPlugins (/vercel/path0/node_modules/next/dist/build/webpack/config/blocks/css/plugins.js:157:47)
[17:06:07.841]     at async /vercel/path0/node_modules/next/dist/build/webpack/config/blocks/css/index.js:124:36
[17:06:07.841]     at async /vercel/path0/node_modules/next/dist/build/webpack/loaders/postcss-loader/src/index.js:51:40
[17:06:07.841]     at async Span.traceAsyncFn (/vercel/path0/node_modules/next/dist/trace/trace.js:154:20)
[17:06:07.841] 
[17:06:07.842] Import trace for requested module:
[17:06:07.842] ./styles/globals.css.webpack[javascript/auto]!=!./node_modules/next/dist/build/webpack/loaders/css-loader/src/index.js??ruleSet[1].rules[6].oneOf[14].use[1]!./node_modules/next/dist/build/webpack/loaders/postcss-loader/src/index.js??ruleSet[1].rules[6].oneOf[14].use[2]!./styles/globals.css
[17:06:07.842] ./styles/globals.css
[17:06:07.842] 
[17:06:07.842] ./styles/globals.css
[17:06:07.842] Error: Cannot find module 'tailwindcss'
[17:06:07.842] Require stack:
[17:06:07.842] - /vercel/path0/node_modules/next/dist/build/webpack/config/blocks/css/plugins.js
[17:06:07.842] - /vercel/path0/node_modules/next/dist/build/webpack/config/blocks/css/index.js
[17:06:07.842] - /vercel/path0/node_modules/next/dist/build/webpack/config/index.js
[17:06:07.843] - /vercel/path0/node_modules/next/dist/build/webpack-config.js
[17:06:07.843] - /vercel/path0/node_modules/next/dist/build/webpack-build/impl.js
[17:06:07.843] - /vercel/path0/node_modules/next/dist/compiled/jest-worker/processChild.js
[17:06:07.843]     at Function.<anonymous> (node:internal/modules/cjs/loader:1365:15)
[17:06:07.843]     at /vercel/path0/node_modules/next/dist/server/require-hook.js:55:36
[17:06:07.843]     at Function.resolve (node:internal/modules/helpers:145:19)
[17:06:07.843]     at loadPlugin (/vercel/path0/node_modules/next/dist/build/webpack/config/blocks/css/plugins.js:49:32)
[17:06:07.843]     at /vercel/path0/node_modules/next/dist/build/webpack/config/blocks/css/plugins.js:157:56
[17:06:07.843]     at Array.map (<anonymous>)
[17:06:07.843]     at getPostCssPlugins (/vercel/path0/node_modules/next/dist/build/webpack/config/blocks/css/plugins.js:157:47)
[17:06:07.843]     at async /vercel/path0/node_modules/next/dist/build/webpack/config/blocks/css/index.js:124:36
[17:06:07.843]     at async /vercel/path0/node_modules/next/dist/build/webpack/loaders/postcss-loader/src/index.js:51:40
[17:06:07.845]     at async Span.traceAsyncFn (/vercel/path0/node_modules/next/dist/trace/trace.js:154:20)
[17:06:07.845]     at tryRunOrWebpackError (/vercel/path0/node_modules/next/dist/compiled/webpack/bundle5.js:28:312989)
[17:06:07.846]     at __webpack_require_module__ (/vercel/path0/node_modules/next/dist/compiled/webpack/bundle5.js:28:131165)
[17:06:07.846]     at __nested_webpack_require_153728__ (/vercel/path0/node_modules/next/dist/compiled/webpack/bundle5.js:28:130607)
[17:06:07.846]     at /vercel/path0/node_modules/next/dist/compiled/webpack/bundle5.js:28:131454
[17:06:07.846]     at symbolIterator (/vercel/path0/node_modules/next/dist/compiled/neo-async/async.js:1:14444)
[17:06:07.846]     at done (/vercel/path0/node_modules/next/dist/compiled/neo-async/async.js:1:14824)
[17:06:07.846]     at Hook.eval [as callAsync] (eval at create (/vercel/path0/node_modules/next/dist/compiled/webpack/bundle5.js:13:28858), <anonymous>:15:1)
[17:06:07.846]     at Hook.CALL_ASYNC_DELEGATE [as _callAsync] (/vercel/path0/node_modules/next/dist/compiled/webpack/bundle5.js:13:26012)
[17:06:07.846]     at /vercel/path0/node_modules/next/dist/compiled/webpack/bundle5.js:28:130328
[17:06:07.846]     at symbolIterator (/vercel/path0/node_modules/next/dist/compiled/neo-async/async.js:1:14402)
[17:06:07.846] -- inner error --
[17:06:07.846] Error: Cannot find module 'tailwindcss'
[17:06:07.846] Require stack:
[17:06:07.846] - /vercel/path0/node_modules/next/dist/build/webpack/config/blocks/css/plugins.js
[17:06:07.846] - /vercel/path0/node_modules/next/dist/build/webpack/config/blocks/css/index.js
[17:06:07.846] - /vercel/path0/node_modules/next/dist/build/webpack/config/index.js
[17:06:07.846] - /vercel/path0/node_modules/next/dist/build/webpack-config.js
[17:06:07.846] - /vercel/path0/node_modules/next/dist/build/webpack-build/impl.js
[17:06:07.846] - /vercel/path0/node_modules/next/dist/compiled/jest-worker/processChild.js
[17:06:07.847]     at Function.<anonymous> (node:internal/modules/cjs/loader:1365:15)
[17:06:07.847]     at /vercel/path0/node_modules/next/dist/server/require-hook.js:55:36
[17:06:07.847]     at Function.resolve (node:internal/modules/helpers:145:19)
[17:06:07.847]     at loadPlugin (/vercel/path0/node_modules/next/dist/build/webpack/config/blocks/css/plugins.js:49:32)
[17:06:07.847]     at /vercel/path0/node_modules/next/dist/build/webpack/config/blocks/css/plugins.js:157:56
[17:06:07.847]     at Array.map (<anonymous>)
[17:06:07.847]     at getPostCssPlugins (/vercel/path0/node_modules/next/dist/build/webpack/config/blocks/css/plugins.js:157:47)
[17:06:07.847]     at async /vercel/path0/node_modules/next/dist/build/webpack/config/blocks/css/index.js:124:36
[17:06:07.847]     at async /vercel/path0/node_modules/next/dist/build/webpack/loaders/postcss-loader/src/index.js:51:40
[17:06:07.847]     at async Span.traceAsyncFn (/vercel/path0/node_modules/next/dist/trace/trace.js:154:20)
[17:06:07.847]     at Object.<anonymous> (/vercel/path0/node_modules/next/dist/build/webpack/loaders/css-loader/src/index.js??ruleSet[1].rules[6].oneOf[14].use[1]!/vercel/path0/node_modules/next/dist/build/webpack/loaders/postcss-loader/src/index.js??ruleSet[1].rules[6].oneOf[14].use[2]!/vercel/path0/styles/globals.css:1:7)
[17:06:07.847]     at /vercel/path0/node_modules/next/dist/compiled/webpack/bundle5.js:28:922493
[17:06:07.847]     at Hook.eval [as call] (eval at create (/vercel/path0/node_modules/next/dist/compiled/webpack/bundle5.js:13:28636), <anonymous>:7:1)
[17:06:07.847]     at Hook.CALL_DELEGATE [as _call] (/vercel/path0/node_modules/next/dist/compiled/webpack/bundle5.js:13:25906)
[17:06:07.847]     at /vercel/path0/node_modules/next/dist/compiled/webpack/bundle5.js:28:131198
[17:06:07.847]     at tryRunOrWebpackError (/vercel/path0/node_modules/next/dist/compiled/webpack/bundle5.js:28:312943)
[17:06:07.847]     at __webpack_require_module__ (/vercel/path0/node_modules/next/dist/compiled/webpack/bundle5.js:28:131165)
[17:06:07.847]     at __nested_webpack_require_153728__ (/vercel/path0/node_modules/next/dist/compiled/webpack/bundle5.js:28:130607)
[17:06:07.848]     at /vercel/path0/node_modules/next/dist/compiled/webpack/bundle5.js:28:131454
[17:06:07.848]     at symbolIterator (/vercel/path0/node_modules/next/dist/compiled/neo-async/async.js:1:14444)
[17:06:07.848] 
[17:06:07.848] Generated code for /vercel/path0/node_modules/next/dist/build/webpack/loaders/css-loader/src/index.js??ruleSet[1].rules[6].oneOf[14].use[1]!/vercel/path0/node_modules/next/dist/build/webpack/loaders/postcss-loader/src/index.js??ruleSet[1].rules[6].oneOf[14].use[2]!/vercel/path0/styles/globals.css
[17:06:07.848] 
[17:06:07.848] Import trace for requested module:
[17:06:07.848] ./styles/globals.css
[17:06:07.848] 
[17:06:07.851] 
[17:06:07.852] > Build failed because of webpack errors
[17:06:07.874] Error: Command "npm run build" exited with 1
