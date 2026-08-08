import nextVitals from 'eslint-config-next/core-web-vitals';

const config = [
  {
    // DELETE/ は CLAUDE.md で定めたゴミ箱で .gitignore 済み。CI は clone した
    // ツリーで動くため存在しないが、ローカルには退避したファイルが溜まるので、
    // 検査対象から外さないと手元の lint が常に失敗する。
    ignores: ['app-ui/**', '.next/**', 'node_modules/**', 'DELETE/**'],
  },
  ...(Array.isArray(nextVitals) ? nextVitals : [nextVitals]),
];

export default config;
