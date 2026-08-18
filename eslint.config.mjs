import nextVitals from 'eslint-config-next/core-web-vitals';

const config = [
  {
    // DELETE/ は CLAUDE.md で定めたゴミ箱。ローカルには退避したファイルが溜まり、
    // 検査対象から外さないと手元の lint が常に失敗する。
    //
    // なお /DELETE/ を .gitignore に入れる前に commit された
    // DELETE/src/lib/client-error-url.js と DELETE/test/client-error-url.test.mjs の
    // 2ファイルは今も追跡されており、clone したツリーにも存在する。この除外により
    // その2つも検査されなくなるが、いずれもゴミ箱に置かれた残骸で、
    // アプリからは参照されていない（`git ls-files DELETE` で確認できる）。
    // 追跡から外すかどうかは手動で判断すること。
    // .next-playwright-dev-session-race/ は board-list-dev-session-race.playwright.test.mjs
    // が作る development焼き込み専用ビルドの出力先（.next/ の外側、next.config.ts の
    // distDir参照）。ビルド成果物なので通常の .next/ と同様に検査対象から外す。
    ignores: ['app-ui/**', '.next/**', '.next-playwright-dev-session-race/**', 'node_modules/**', 'DELETE/**'],
  },
  ...(Array.isArray(nextVitals) ? nextVitals : [nextVitals]),
];

export default config;
