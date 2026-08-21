import nextVitals from 'eslint-config-next/core-web-vitals';

const config = [
  {
    // DELETE/ は CLAUDE.md で定めたゴミ箱。ローカルには退避したファイルが溜まり、
    // 検査対象から外さないと手元の lint が常に失敗する。
    //
    // .gitignore に入れる前に commit された2ファイルが追跡され続けていたが、
    // issue #245 で追跡から外した。clone したツリーに DELETE/ は存在しない。
    ignores: ['app-ui/**', '.next/**', 'node_modules/**', 'DELETE/**'],
  },
  ...(Array.isArray(nextVitals) ? nextVitals : [nextVitals]),
];

export default config;
